//! Mermaid diagrams for the Markdown preview, as SVG. mmdflux renders flowchart, class, sequence and
//! state diagrams in Rust, so the front end needs no Mermaid script. The front end shows the SVG in an
//! <img>, where it runs no scripts and loads nothing.

use mmdflux::{apply_svg_surface_defaults, render_diagram, OutputFormat, RenderConfig, SvgThemeConfig};

/// The Mermaid source text is limited, so a big diagram cannot block the backend for long.
const MAX_SOURCE: usize = 64 * 1024;

/// The SVG of a Mermaid diagram, in the light or the dark theme, on the background `bg` (`#rrggbb`).
/// An error for a diagram type that mmdflux does not render, or for a syntax error.
pub fn svg(source: &str, dark: bool, bg: Option<&str>) -> Result<String, String> {
    if source.len() > MAX_SOURCE {
        return Err("The diagram is larger than 64 KB".into());
    }
    let mut config = RenderConfig::default();
    let mut theme = SvgThemeConfig { name: Some(if dark { "github-dark" } else { "github-light" }.into()), ..SvgThemeConfig::default() };
    // Only a plain hex color goes into the SVG.
    if let Some(bg) = bg.filter(|c| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())) {
        theme.bg = Some(bg.to_string());
    }
    config.svg_theme = Some(theme);
    apply_svg_surface_defaults(OutputFormat::Svg, &mut config, true);
    render_diagram(source.trim(), OutputFormat::Svg, &config).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::svg;

    #[test]
    fn renders_a_flowchart_and_a_sequence() {
        let flow = svg("graph TD\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Ship]", false, Some("#ffffff")).unwrap();
        assert!(flow.starts_with("<svg") || flow.contains("<svg"), "{flow}");
        assert!(flow.contains("Start") && flow.contains("Ship"));
        let seq = svg("sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi", true, None).unwrap();
        assert!(seq.contains("Alice") && seq.contains("Hello"));
    }

    #[test]
    fn refuses_what_it_cannot_render() {
        assert!(svg("gantt\n  title A plan\n  section S\n  Task :a1, 2024-01-01, 3d", false, None).is_err());
        assert!(svg("this is not mermaid", false, None).is_err());
        assert!(svg(&"graph TD\n".repeat(10_000), false, None).is_err());
    }

    #[test]
    fn takes_only_a_hex_background() {
        let bad = svg("graph TD\n  A --> B", false, Some("red\" onload=\"x")).unwrap();
        assert!(!bad.contains("onload"));
        let good = svg("graph TD\n  A --> B", false, Some("#123abc")).unwrap();
        assert!(good.to_lowercase().contains("#123abc"));
    }
}
