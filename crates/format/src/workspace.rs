use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::error::FormatError;
use crate::globals::Globals;
use crate::manifest::{FileInfo, Manifest};

/// Workspace structure
#[derive(Debug)]
pub struct Workspace {
    /// Root path
    pub root: PathBuf,
    /// Manifest
    pub manifest: Manifest,
    /// Globals
    pub globals: Globals,
    /// Loaded files cache
    files: HashMap<String, String>,
}

/// Workspace directory structure
pub const MANIFEST_FILE: &str = "manifest.json";
pub const GLOBALS_FILE: &str = "globals.numr";
pub const FILES_DIR: &str = "files";
pub const SYNC_DIR: &str = ".sync";

impl Workspace {
    /// Create a new workspace
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            manifest: Manifest::new(),
            globals: Globals::new(),
            files: HashMap::new(),
        }
    }

    /// Load workspace from directory
    pub fn load(root: PathBuf) -> Result<Self, FormatError> {
        let mut workspace = Self::new(root);
        workspace.reload()?;
        Ok(workspace)
    }

    /// Reload workspace data
    pub fn reload(&mut self) -> Result<(), FormatError> {
        // Load manifest
        let manifest_path = self.root.join(MANIFEST_FILE);
        if manifest_path.exists() {
            let content = std::fs::read_to_string(&manifest_path)?;
            self.manifest = Manifest::from_json(&content)
                .map_err(|e| FormatError::InvalidManifest(e.to_string()))?;
        }

        // Load globals
        let globals_path = self.root.join(GLOBALS_FILE);
        if globals_path.exists() {
            let content = std::fs::read_to_string(&globals_path)?;
            self.globals = Globals::parse(&content);
        }

        Ok(())
    }

    /// Save workspace data
    pub fn save(&self) -> Result<(), FormatError> {
        // Ensure directories exist
        let files_dir = self.root.join(FILES_DIR);
        let sync_dir = self.root.join(SYNC_DIR);
        std::fs::create_dir_all(&files_dir)?;
        std::fs::create_dir_all(&sync_dir)?;

        // Save manifest
        let manifest_path = self.root.join(MANIFEST_FILE);
        let manifest_json = self.manifest.to_json()
            .map_err(|e| FormatError::InvalidManifest(e.to_string()))?;
        std::fs::write(&manifest_path, manifest_json)?;

        // Save globals
        let globals_path = self.root.join(GLOBALS_FILE);
        let globals_content = self.globals.to_numr();
        std::fs::write(&globals_path, globals_content)?;

        Ok(())
    }

    /// Get the files directory path
    pub fn files_dir(&self) -> PathBuf {
        self.root.join(FILES_DIR)
    }

    /// Get a file path
    pub fn file_path(&self, relative_path: &str) -> PathBuf {
        self.files_dir().join(relative_path)
    }

    /// Load a file content
    pub fn load_file(&mut self, relative_path: &str) -> Result<String, FormatError> {
        if let Some(content) = self.files.get(relative_path) {
            return Ok(content.clone());
        }

        let path = self.file_path(relative_path);
        if !path.exists() {
            return Err(FormatError::FileNotFound(relative_path.to_string()));
        }

        let content = std::fs::read_to_string(&path)?;
        self.files.insert(relative_path.to_string(), content.clone());
        Ok(content)
    }

    /// Save a file
    pub fn save_file(&mut self, relative_path: &str, content: &str) -> Result<(), FormatError> {
        let path = self.file_path(relative_path);
        
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(&path, content)?;
        self.files.insert(relative_path.to_string(), content.to_string());

        // Update manifest if not exists
        if !self.manifest.files.contains_key(relative_path) {
            let display_name = Path::new(relative_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(relative_path)
                .to_string();

            self.manifest.add_file(
                relative_path,
                FileInfo::new(&display_name),
            );
        }

        Ok(())
    }

    /// Delete a file
    pub fn delete_file(&mut self, relative_path: &str) -> Result<(), FormatError> {
        let path = self.file_path(relative_path);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        self.files.remove(relative_path);
        self.manifest.remove_file(relative_path);
        Ok(())
    }

    /// List all .numr files
    pub fn list_files(&self) -> Result<Vec<String>, FormatError> {
        let files_dir = self.files_dir();
        if !files_dir.exists() {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        self.collect_numr_files(&files_dir, &mut files)?;

        // Convert to relative paths
        let relative_files: Vec<String> = files
            .iter()
            .filter_map(|p| {
                p.strip_prefix(&files_dir)
                    .ok()
                    .and_then(|p| p.to_str())
                    .map(|s| s.to_string())
            })
            .collect();

        Ok(relative_files)
    }

    /// Recursively collect .numr files
    fn collect_numr_files(&self, dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), FormatError> {
        if !dir.is_dir() {
            return Ok(());
        }

        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                self.collect_numr_files(&path, files)?;
            } else if path.extension().and_then(|s| s.to_str()) == Some("numr") {
                files.push(path);
            }
        }

        Ok(())
    }

    /// Check if workspace is initialized
    pub fn is_initialized(&self) -> bool {
        self.root.join(MANIFEST_FILE).exists()
    }

    /// Initialize workspace structure
    pub fn initialize(&self) -> Result<(), FormatError> {
        std::fs::create_dir_all(self.root.join(FILES_DIR))?;
        std::fs::create_dir_all(self.root.join(SYNC_DIR))?;
        std::fs::create_dir_all(self.root.join(SYNC_DIR).join("conflicts"))?;
        self.save()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_workspace_creation() {
        let dir = tempdir().unwrap();
        let workspace = Workspace::new(dir.path().to_path_buf());
        assert!(!workspace.is_initialized());
    }

    #[test]
    fn test_workspace_initialize() {
        let dir = tempdir().unwrap();
        let workspace = Workspace::new(dir.path().to_path_buf());
        workspace.initialize().unwrap();
        assert!(workspace.is_initialized());
        assert!(dir.path().join(FILES_DIR).exists());
        assert!(dir.path().join(SYNC_DIR).exists());
    }

    #[test]
    fn test_save_and_load_file() {
        let dir = tempdir().unwrap();
        let mut workspace = Workspace::new(dir.path().to_path_buf());
        workspace.initialize().unwrap();

        workspace.save_file("test.numr", "100 + 200").unwrap();
        let content = workspace.load_file("test.numr").unwrap();
        assert_eq!(content, "100 + 200");
    }
}
