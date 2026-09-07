use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Global variables file (globals.numr)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Globals {
    /// Variables
    pub variables: HashMap<String, String>,
    /// Functions
    pub functions: HashMap<String, String>,
    /// Constants
    pub constants: HashMap<String, String>,
}

impl Globals {
    /// Create new empty globals
    pub fn new() -> Self {
        Self {
            variables: HashMap::new(),
            functions: HashMap::new(),
            constants: HashMap::new(),
        }
    }

    /// Parse globals from .numr file content
    pub fn parse(content: &str) -> Self {
        let mut globals = Self::new();

        for line in content.lines() {
            let line = line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
                continue;
            }

            // Parse variable assignment
            if let Some(eq_pos) = line.find('=') {
                let name = line[..eq_pos].trim();
                let value = line[eq_pos + 1..].trim();

                // Check if it's a function definition (has parentheses)
                if name.contains('(') {
                    globals.functions.insert(name.to_string(), value.to_string());
                } else {
                    // Check if it looks like a constant (uppercase)
                    if name.chars().all(|c| c.is_uppercase() || c == '_') {
                        globals.constants.insert(name.to_string(), value.to_string());
                    } else {
                        globals.variables.insert(name.to_string(), value.to_string());
                    }
                }
            }
        }

        globals
    }

    /// Get a variable value
    pub fn get_variable(&self, name: &str) -> Option<&String> {
        self.variables.get(name)
    }

    /// Set a variable
    pub fn set_variable(&mut self, name: &str, value: &str) {
        self.variables.insert(name.to_string(), value.to_string());
    }

    /// Remove a variable
    pub fn remove_variable(&mut self, name: &str) -> Option<String> {
        self.variables.remove(name)
    }

    /// Get all variable names
    pub fn variable_names(&self) -> Vec<&String> {
        self.variables.keys().collect()
    }

    /// Serialize to .numr format
    pub fn to_numr(&self) -> String {
        let mut lines = Vec::new();

        lines.push("# Global Variables".to_string());
        lines.push(String::new());

        // Sort variables for consistent output
        let mut vars: Vec<_> = self.variables.iter().collect();
        vars.sort_by_key(|(name, _)| name.as_str());

        for (name, value) in vars {
            lines.push(format!("{} = {}", name, value));
        }

        if !self.functions.is_empty() {
            lines.push(String::new());
            lines.push("# Global Functions".to_string());
            lines.push(String::new());

            let mut funcs: Vec<_> = self.functions.iter().collect();
            funcs.sort_by_key(|(name, _)| name.as_str());

            for (name, value) in funcs {
                lines.push(format!("{} = {}", name, value));
            }
        }

        if !self.constants.is_empty() {
            lines.push(String::new());
            lines.push("# Constants".to_string());
            lines.push(String::new());

            let mut consts: Vec<_> = self.constants.iter().collect();
            consts.sort_by_key(|(name, _)| name.as_str());

            for (name, value) in consts {
                lines.push(format!("{} = {}", name, value));
            }
        }

        lines.join("\n")
    }

    /// Merge with another globals (for sync)
    pub fn merge(&mut self, other: &Globals) {
        for (name, value) in &other.variables {
            self.variables.insert(name.clone(), value.clone());
        }
        for (name, value) in &other.functions {
            self.functions.insert(name.clone(), value.clone());
        }
        for (name, value) in &other.constants {
            self.constants.insert(name.clone(), value.clone());
        }
    }
}

impl Default for Globals {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_globals() {
        let content = r#"
# Global Variables
tax_rate = 13%
hourly_rate = $85

# Global Functions
margin(cost, rate) = cost * rate / (1 - rate)

# Constants
PI = 3.14159
"#;

        let globals = Globals::parse(content);
        assert_eq!(globals.get_variable("tax_rate"), Some(&"13%".to_string()));
        assert_eq!(globals.get_variable("hourly_rate"), Some(&"$85".to_string()));
        assert!(globals.functions.contains_key("margin(cost, rate)"));
        assert_eq!(globals.constants.get("PI"), Some(&"3.14159".to_string()));
    }

    #[test]
    fn test_to_numr() {
        let mut globals = Globals::new();
        globals.set_variable("tax", "10%");
        globals.set_variable("rate", "$100");

        let output = globals.to_numr();
        assert!(output.contains("tax = 10%"));
        assert!(output.contains("rate = $100"));
    }
}
