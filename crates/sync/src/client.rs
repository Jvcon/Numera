use crate::error::SyncError;

/// A single entry returned from a WebDAV `PROPFIND` listing.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DavEntry {
    /// Decoded path as reported by the server, e.g. `/folder/file.numr`.
    pub href: String,
    /// Server ETag (surrounding quotes stripped), if the resource has one.
    pub etag: Option<String>,
    /// `getcontentlength`, when reported.
    pub content_length: Option<u64>,
    /// `true` when the entry is a collection (directory).
    pub is_collection: bool,
}

/// Result of downloading a file: raw content plus its server ETag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GetFileResult {
    /// Raw file bytes.
    pub content: Vec<u8>,
    /// ETag from the response `ETag` header (quotes stripped), if present.
    pub etag: Option<String>,
}

/// Body used for `PROPFIND` requests requesting only the properties we need.
const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>"#;

/// RFC 4918 custom method: PROPFIND.
fn method_propfind() -> reqwest::Method {
    reqwest::Method::from_bytes(b"PROPFIND").expect("PROPFIND is a valid method token")
}

/// RFC 4918 custom method: MKCOL.
fn method_mkcol() -> reqwest::Method {
    reqwest::Method::from_bytes(b"MKCOL").expect("MKCOL is a valid method token")
}

/// WebDAV client for synchronization
pub struct WebDavClient {
    base_url: String,
    username: Option<String>,
    password: Option<String>,
    client: reqwest::Client,
}

impl WebDavClient {
    /// Create a new WebDAV client pointing at `base_url` (the WebDAV root
    /// collection). A trailing `/` is stripped from `base_url`.
    pub fn new(base_url: &str) -> Self {
        let base_url = base_url.trim_end_matches('/').to_string();
        Self {
            base_url,
            username: None,
            password: None,
            client: reqwest::Client::new(),
        }
    }

    /// Set authentication credentials
    pub fn with_auth(mut self, username: &str, password: &str) -> Self {
        self.username = Some(username.to_string());
        self.password = Some(password.to_string());
        self
    }

    /// Check if connected.
    ///
    /// Sends a `PROPFIND` with `Depth: 0` to the base URL and returns
    /// `Ok(true)` on any 2xx/3xx (including `207 Multi-Status`). Credential /
    /// permission problems map to [`SyncError::AuthError`]; other failures are
    /// returned as an `Err` so the caller can surface a clear message.
    pub async fn check_connection(&self) -> Result<bool, SyncError> {
        let response = self
            .build_request(method_propfind(), "")
            .header("Depth", "0")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(PROPFIND_BODY.as_bytes().to_vec())
            .send()
            .await?;

        let status = response.status();
        if status.is_success() || status.is_redirection() {
            return Ok(true);
        }
        Err(Self::http_error(status))
    }

    /// List the direct children of the collection at `path`.
    ///
    /// Sends a `PROPFIND` with `Depth: 1` and returns a `Vec<DavEntry>` for
    /// every child. The entry describing the queried collection itself is
    /// skipped.
    pub async fn list_files(&self, path: &str) -> Result<Vec<DavEntry>, SyncError> {
        let response = self
            .build_request(method_propfind(), path)
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(PROPFIND_BODY.as_bytes().to_vec())
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            return Err(Self::http_error(status));
        }

        let body = response.text().await?;
        let entries = parse_multistatus(&body)?;
        Ok(entries
            .into_iter()
            .filter(|entry| !self.is_self_entry(entry, path))
            .collect())
    }

    /// Download the file at `path`.
    ///
    /// Returns the raw bytes and the `ETag` from the response header. A `404`
    /// maps to [`SyncError::FileNotFound`].
    pub async fn get_file(&self, path: &str) -> Result<GetFileResult, SyncError> {
        let response = self
            .build_request(reqwest::Method::GET, path)
            .send()
            .await?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(SyncError::FileNotFound(path.to_string()));
        }
        if !status.is_success() {
            return Err(Self::http_error(status));
        }

        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(strip_quotes);
        let content = response.bytes().await?.to_vec();

        Ok(GetFileResult { content, etag })
    }

    /// Upload `content` to `path`.
    ///
    /// When `if_match` is `Some`, an `If-Match` header is sent so the server
    /// only overwrites the resource when its current ETag matches (optimistic
    /// concurrency). Returns `Ok(())` on 200/201/204.
    pub async fn put_file(
        &self,
        path: &str,
        content: &[u8],
        if_match: Option<&str>,
    ) -> Result<(), SyncError> {
        let mut request = self
            .build_request(reqwest::Method::PUT, path)
            .header("Content-Type", "application/octet-stream")
            .body(content.to_vec());
        if let Some(etag) = if_match {
            request = request.header("If-Match", etag);
        }

        let response = request.send().await?;
        let status = response.status();
        if matches!(
            status,
            reqwest::StatusCode::OK
                | reqwest::StatusCode::CREATED
                | reqwest::StatusCode::NO_CONTENT
        ) {
            return Ok(());
        }
        Err(Self::http_error(status))
    }

    /// Delete the resource at `path`.
    ///
    /// Returns `Ok(())` on 200/204.
    pub async fn delete_file(&self, path: &str) -> Result<(), SyncError> {
        let response = self
            .build_request(reqwest::Method::DELETE, path)
            .send()
            .await?;

        let status = response.status();
        if matches!(status, reqwest::StatusCode::OK | reqwest::StatusCode::NO_CONTENT) {
            return Ok(());
        }
        Err(Self::http_error(status))
    }

    /// Create a collection (directory) at `path`.
    ///
    /// Uses `MKCOL`. `201 Created` is success; `405` ("already exists") is
    /// tolerated as success too.
    pub async fn create_directory(&self, path: &str) -> Result<(), SyncError> {
        let response = self
            .build_request(method_mkcol(), path)
            .send()
            .await?;

        let status = response.status();
        if matches!(status, reqwest::StatusCode::CREATED | reqwest::StatusCode::METHOD_NOT_ALLOWED)
        {
            return Ok(());
        }
        Err(Self::http_error(status))
    }

    /// Build a request to `{base_url}/{path}`, applying Basic auth when
    /// credentials have been configured.
    fn build_request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = self.join_url(path);
        let mut request = self.client.request(method, url);
        if let (Some(username), Some(password)) = (&self.username, &self.password) {
            request = request.basic_auth(username, Some(password));
        }
        request
    }

    /// Concatenate `base_url` and a relative WebDAV `path`, always inserting
    /// exactly one `/` between the two and never producing double slashes.
    fn join_url(&self, path: &str) -> String {
        let path = path.trim_start_matches('/');
        if path.is_empty() {
            return self.base_url.clone();
        }
        if self.base_url.ends_with('/') {
            format!("{}{}", self.base_url, path)
        } else {
            format!("{}/{}", self.base_url, path)
        }
    }

    /// Decide whether a parsed entry refers to the collection that `list_files`
    /// was asked to list (the "self" response of a `Depth: 1` PROPFIND).
    fn is_self_entry(&self, entry: &DavEntry, path: &str) -> bool {
        let href = entry.href.trim_end_matches('/');
        if href.is_empty() {
            return false;
        }
        let requested = path.trim_matches('/');
        let base_path = reqwest::Url::parse(&self.base_url)
            .map(|url| url.path().trim_end_matches('/').to_string())
            .unwrap_or_default();

        let candidates: Vec<String> = if requested.is_empty() {
            vec![base_path.clone()]
        } else if base_path.is_empty() {
            vec![format!("/{}", requested)]
        } else {
            vec![format!("{}/{}", base_path, requested)]
        };

        candidates.iter().any(|candidate| candidate == href)
    }

    /// Map a non-success HTTP status to a [`SyncError`].
    ///
    /// 401/403 become [`SyncError::AuthError`]; everything else becomes
    /// [`SyncError::HttpError`].
    fn http_error(status: reqwest::StatusCode) -> SyncError {
        match status {
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
                SyncError::AuthError
            }
            _ => SyncError::HttpError {
                status: status.as_u16(),
                message: status
                    .canonical_reason()
                    .unwrap_or("HTTP request failed")
                    .to_string(),
            },
        }
    }
}

/// Parse a `207 Multi-Status` PROPFIND response body into [`DavEntry`]s.
///
/// For every `<d:response>` the `href` is taken verbatim (percent-decoded).
/// Only properties from a `<d:propstat>` whose `<d:status>` line contains
/// `" 200 "` are considered, so e.g. a `404` propstat reporting unsupported
/// properties (`getetag`/`getcontentlength` on collections) is ignored.
fn parse_multistatus(xml: &str) -> Result<Vec<DavEntry>, SyncError> {
    let doc = roxmltree::Document::parse(xml)
        .map_err(|error| SyncError::DavParseError(error.to_string()))?;

    let mut entries = Vec::new();
    for response in doc
        .descendants()
        .filter(|node| node.is_element() && node.has_tag_name("response"))
    {
        let Some(href_node) = response
            .children()
            .find(|node| node.is_element() && node.has_tag_name("href"))
        else {
            continue;
        };
        let href = percent_decode(href_node.text().unwrap_or_default());

        let mut etag: Option<String> = None;
        let mut content_length: Option<u64> = None;
        let mut is_collection = false;

        for propstat in response
            .children()
            .filter(|node| node.is_element() && node.has_tag_name("propstat"))
        {
            let status_ok = propstat
                .descendants()
                .find(|node| node.is_element() && node.has_tag_name("status"))
                .and_then(|node| node.text())
                .map(|status| status.contains(" 200 "))
                .unwrap_or(false);
            if !status_ok {
                continue;
            }

            let Some(prop) = propstat
                .children()
                .find(|node| node.is_element() && node.has_tag_name("prop"))
            else {
                continue;
            };

            if etag.is_none() {
                etag = prop
                    .descendants()
                    .find(|node| node.is_element() && node.has_tag_name("getetag"))
                    .and_then(|node| node.text())
                    .map(strip_quotes);
            }
            if content_length.is_none() {
                content_length = prop
                    .descendants()
                    .find(|node| node.is_element() && node.has_tag_name("getcontentlength"))
                    .and_then(|node| node.text())
                    .and_then(|text| text.trim().parse::<u64>().ok());
            }
            if !is_collection {
                is_collection = prop
                    .descendants()
                    .any(|node| node.is_element() && node.has_tag_name("collection"));
            }
        }

        entries.push(DavEntry {
            href,
            etag,
            content_length,
            is_collection,
        });
    }

    Ok(entries)
}

/// Remove surrounding quotes (and whitespace) from an ETag value.
fn strip_quotes(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

/// Decode percent-encoded octets (e.g. `%20`) in a WebDAV href into a UTF-8
/// string. Invalid sequences are left untouched; non-UTF-8 bytes are replaced
/// lossily.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2])) {
                decoded.push(high << 4 | low);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MULTISTATUS_XML: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/folder/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop>
        <d:getetag>"should-be-ignored"</d:getetag>
        <d:getcontentlength>1234</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/folder/report%20final.numr</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"a1b2c3"</d:getetag>
        <d:getcontentlength>2048</d:getcontentlength>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/folder/sub/</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag/>
        <d:getcontentlength/>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>"#;

    #[test]
    fn parse_multistatus_extracts_entries() {
        let entries = parse_multistatus(MULTISTATUS_XML).expect("should parse");
        assert_eq!(entries.len(), 3);

        // Self collection: 404 propstat (etag/content_length) must be ignored,
        // resourcetype from the 200 propstat wins.
        assert_eq!(
            entries[0],
            DavEntry {
                href: "/folder/".to_string(),
                etag: None,
                content_length: None,
                is_collection: true,
            }
        );

        // File child: percent-decoded href, quotes-stripped etag, size.
        assert_eq!(
            entries[1],
            DavEntry {
                href: "/folder/report final.numr".to_string(),
                etag: Some("a1b2c3".to_string()),
                content_length: Some(2048),
                is_collection: false,
            }
        );

        // Sub-collection child.
        assert_eq!(
            entries[2],
            DavEntry {
                href: "/folder/sub/".to_string(),
                etag: None,
                content_length: None,
                is_collection: true,
            }
        );
    }

    #[test]
    fn parse_multistatus_rejects_malformed_xml() {
        let result = parse_multistatus("<d:multistatus><d:response>");
        assert!(matches!(result, Err(SyncError::DavParseError(_))));
    }

    #[test]
    fn new_strips_trailing_slash() {
        let client = WebDavClient::new("https://example.com/dav/");
        assert_eq!(client.base_url, "https://example.com/dav");

        let client = WebDavClient::new("https://example.com/dav");
        assert_eq!(client.base_url, "https://example.com/dav");
    }

    #[test]
    fn join_url_avoids_double_slashes() {
        let client = WebDavClient::new("https://example.com/dav");
        assert_eq!(client.join_url(""), "https://example.com/dav");
        assert_eq!(client.join_url("a"), "https://example.com/dav/a");
        assert_eq!(client.join_url("a/b"), "https://example.com/dav/a/b");
        assert_eq!(client.join_url("/a/b"), "https://example.com/dav/a/b");
        assert_eq!(
            WebDavClient::new("https://example.com/").join_url("a"),
            "https://example.com/a"
        );
    }

    #[test]
    fn is_self_entry_identifies_collection() {
        let client = WebDavClient::new("https://example.com/dav/user");
        let collection = DavEntry {
            href: "/dav/user/folder/".to_string(),
            etag: None,
            content_length: None,
            is_collection: true,
        };
        let child = DavEntry {
            href: "/dav/user/folder/file.numr".to_string(),
            etag: None,
            content_length: None,
            is_collection: false,
        };
        assert!(client.is_self_entry(&collection, "folder"));
        assert!(!client.is_self_entry(&child, "folder"));
    }

    #[test]
    fn percent_decode_handles_encoded_paths() {
        assert_eq!(percent_decode("/folder/report%20final.numr"), "/folder/report final.numr");
        assert_eq!(percent_decode("/caf%C3%A9/a%2Bb"), "/café/a+b");
        assert_eq!(percent_decode("plain/path"), "plain/path");
    }

    #[test]
    fn strip_quotes_removes_etag_quotes() {
        assert_eq!(strip_quotes(r#""abc""#), "abc");
        assert_eq!(strip_quotes("abc"), "abc");
    }
}
