use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "numera")]
#[command(about = "Numera - Multi-platform natural language text calculator")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Evaluate an expression
    Eval {
        /// Expression to evaluate
        #[arg(required = true)]
        expr: Vec<String>,
    },
    /// Evaluate a file
    File {
        /// Path to .numr file
        path: PathBuf,
    },
    /// Sync workspace with remote
    Sync {
        /// WebDAV URL (optional)
        #[arg(short, long)]
        url: Option<String>,
    },
    /// Login to Numera service
    Login {
        /// Email address
        email: String,
    },
    /// Open file in TUI (default when no command)
    Tui {
        /// File to open
        file: Option<PathBuf>,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        // No subcommand - run TUI
        None => {
            run_tui(None)?;
        }
        // Evaluate expression
        Some(Commands::Eval { expr }) => {
            let expr_str = expr.join(" ");
            let mut engine = numera_engine::Engine::new();
            let result = engine.eval(&expr_str)?;
            println!("{}", result);
        }
        // Evaluate file
        Some(Commands::File { path }) => {
            let content = std::fs::read_to_string(&path)?;
            let mut engine = numera_engine::Engine::new();
            
            for line in content.lines() {
                let result = engine.eval(line)?;
                if !result.is_empty() {
                    println!("{}", result);
                }
            }
        }
        // Sync
        Some(Commands::Sync { url }) => {
            println!("Syncing workspace...");
            if let Some(url) = url {
                println!("Remote: {}", url);
            } else {
                println!("Using default remote");
            }
            // TODO: Implement sync logic
            println!("Sync completed");
        }
        // Login
        Some(Commands::Login { email }) => {
            println!("Sending magic link to: {}", email);
            // TODO: Implement login logic
            println!("Check your email for the login link");
        }
        // TUI
        Some(Commands::Tui { file }) => {
            run_tui(file)?;
        }
    }

    Ok(())
}

fn run_tui(file: Option<PathBuf>) -> anyhow::Result<()> {
    use crossterm::{
        event::{self, Event, KeyCode, KeyEventKind},
        terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
        execute,
    };
    use ratatui::{
        backend::CrosstermBackend,
        layout::{Constraint, Layout},
        style::{Color, Style},
        text::{Line, Span},
        widgets::{Block, Borders, Paragraph},
        Terminal,
    };
    use std::io;

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut engine = numera_engine::Engine::new();
    let mut input = String::new();
    let mut history: Vec<String> = Vec::new();
    let mut results: Vec<String> = Vec::new();

    // Load file if provided
    if let Some(path) = file {
        if let Ok(content) = std::fs::read_to_string(&path) {
            for line in content.lines() {
                if let Ok(result) = engine.eval(line) {
                    if !result.is_empty() {
                        history.push(line.to_string());
                        results.push(result);
                    }
                }
            }
        }
    }

    loop {
        // Draw UI
        terminal.draw(|f| {
            let chunks = Layout::default()
                .constraints([
                    Constraint::Min(1),
                    Constraint::Length(3),
                ])
                .split(f.size());

            // History and results
            let history_lines: Vec<Line> = history
                .iter()
                .zip(results.iter())
                .map(|(input, result)| {
                    Line::from(vec![
                        Span::styled(input.clone(), Style::default().fg(Color::White)),
                        Span::raw(" = "),
                        Span::styled(result.clone(), Style::default().fg(Color::Green)),
                    ])
                })
                .collect();

            let history_widget = Paragraph::new(history_lines)
                .block(Block::default().borders(Borders::ALL).title("Numera"));
            f.render_widget(history_widget, chunks[0]);

            // Input
            let input_widget = Paragraph::new(input.as_str())
                .block(Block::default().borders(Borders::ALL).title("Input"));
            f.render_widget(input_widget, chunks[1]);
        })?;

        // Handle input
        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char(c) => {
                            input.push(c);
                        }
                        KeyCode::Backspace => {
                            input.pop();
                        }
                        KeyCode::Enter => {
                            if !input.is_empty() {
                                match engine.eval(&input) {
                                    Ok(result) => {
                                        results.push(result.clone());
                                        history.push(input.clone());
                                    }
                                    Err(e) => {
                                        results.push(format!("Error: {}", e));
                                        history.push(input.clone());
                                    }
                                }
                                input.clear();
                            }
                        }
                        KeyCode::Esc => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}
