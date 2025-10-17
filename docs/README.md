# PublicAppView Documentation Site

This directory contains the GitHub Pages documentation site for PublicAppView with the Aurora Stack theme.

## Local Development

To preview the site locally:

1. Install a simple HTTP server (if you don't have one):
   ```bash
   npm install -g http-server
   ```

2. Serve the docs directory:
   ```bash
   cd docs
   http-server -p 8080
   ```

3. Open http://localhost:8080 in your browser

## GitHub Pages Setup

To enable GitHub Pages for this repository:

1. Go to your GitHub repository settings
2. Navigate to **Pages** (under "Code and automation")
3. Under **Source**, select:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/docs`
4. Click **Save**

Your site will be published at: `https://yourusername.github.io/PublicAppView/`

## Customization

### Update Repository Links

Edit `index.html` and replace all instances of:
- `yourusername` with your GitHub username
- Repository name if different from `PublicAppView`

### Update Colors

The Aurora theme colors are defined in `css/aurora.css`:
- **Teal**: `#00F5D4` (Primary accent)
- **Green**: `#9AEF82` (Secondary accent)
- **Purple**: `#B900F5` (Tertiary accent)
- **Background**: `#0D1117` (Deep space blue)
- **Card**: `#161B22` (Card background)

### Add More Pages

Create additional HTML pages in the `docs/` directory and link to them from `index.html`.

## Features

- ✨ Aurora Stack theme matching the AppView UI
- 📱 Fully responsive design
- 🌊 Animated background effects
- 📋 Copy buttons for code blocks
- 🎯 Smooth scroll navigation
- ⚡ Fast loading with minimal dependencies

## Structure

```
docs/
├── index.html          # Main landing page
├── css/
│   └── aurora.css      # Aurora theme styles
├── js/
│   └── main.js         # Interactive features
├── _config.yml         # GitHub Pages config
└── README.md           # This file
```

## License

MIT License - Same as the main project
