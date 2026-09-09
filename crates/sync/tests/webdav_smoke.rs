//! Integration test for the WebDAV client against a real local server.
//!
//! Requires a WebDAV server at `WEBDAV_URL` (default `http://127.0.0.1:8080`).
//! Skips gracefully when none is reachable, so a plain `cargo test` still
//! passes without a server running.

use numera_sync::WebDavClient;

fn base_url() -> String {
    std::env::var("WEBDAV_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string())
}

#[tokio::test(flavor = "multi_thread")]
async fn webdav_roundtrip_against_local_server() {
    let url = base_url();
    let client = WebDavClient::new(&url);

    // Skip when no server is reachable (plain `cargo test` in CI).
    if client.check_connection().await.is_err() {
        eprintln!("skipping: no WebDAV server reachable at {url}");
        return;
    }

    // 1. create a collection
    client
        .create_directory("smoke-test")
        .await
        .expect("MKCOL smoke-test");

    // 2. upload a file
    let payload = b"monthly_income = $6,500\nsavings = monthly_income * 0.5\n";
    client
        .put_file("smoke-test/hello.numr", payload, None)
        .await
        .expect("PUT hello.numr");

    // 3. list the collection (Depth 1): exactly one child, a file with the
    //    right content length.
    let entries = client
        .list_files("smoke-test")
        .await
        .expect("PROPFIND smoke-test");
    assert_eq!(entries.len(), 1, "expected one child, got {entries:?}");
    let entry = &entries[0];
    assert!(!entry.is_collection, "file must not be a collection");
    assert_eq!(entry.content_length, Some(payload.len() as u64));

    // 4. read the file back (content + ETag).
    let got = client
        .get_file("smoke-test/hello.numr")
        .await
        .expect("GET hello.numr");
    assert_eq!(got.content.as_slice(), payload.as_slice());
    assert!(got.etag.is_some(), "GET must return an ETag");

    // 5. overwrite and read back.
    let payload2 = b"answer = 42\n";
    client
        .put_file("smoke-test/hello.numr", payload2, None)
        .await
        .expect("PUT overwrite");
    let got2 = client
        .get_file("smoke-test/hello.numr")
        .await
        .expect("GET overwritten");
    assert_eq!(got2.content.as_slice(), payload2.as_slice());

    // 6. delete the file; the collection is now empty.
    client
        .delete_file("smoke-test/hello.numr")
        .await
        .expect("DELETE hello.numr");
    let entries = client
        .list_files("smoke-test")
        .await
        .expect("PROPFIND after delete");
    assert!(entries.is_empty(), "expected empty after delete, got {entries:?}");

    // 7. remove the collection.
    client
        .delete_file("smoke-test")
        .await
        .expect("DELETE smoke-test");

    eprintln!("webdav_roundtrip_against_local_server: OK");
}
