# Security

Please don't report a security problem in a public issue. Use [Report a vulnerability](https://github.com/speys-app/speys-vscode/security/advisories/new) on GitHub, which reaches the maintainers privately.

Say what an attacker could do and how to reproduce it. Fixes go to the `main` branch; there are no separately supported versions.

Speys Tools runs inside VS Code with your permissions and doesn't go on the network. It reads and rewrites your workspace's folder list, opens terminals, and opens files in your browser when you ask. A workspace or file making it run a command you didn't choose is a report worth sending.
