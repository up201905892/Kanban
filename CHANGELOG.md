# Changelog

All notable changes to this project are recorded here, in the format of [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added

- The app now has a starting point: a web page and a server with a health check that reports when the service is running (KB-001).
- The server now connects to a database and has a readiness check that tells whether the database is reachable (KB-002).
- Errors from the server now follow one consistent format and carry a request id, which makes problems easier to trace and report (KB-003).
- The web app now has page navigation, a "page not found" screen, a recovery screen with a Reload button when something goes wrong, and accessible basic building blocks such as buttons, form fields and dialogs (KB-004).
- Groundwork for ordering cards and columns on the board: a reliable way to place an item between two others, plus documented rules for what happens when several people edit or move the same card at once (KB-010).
- People can now create an account with email and password, log in and log out; sessions last 30 days and sign-up and log-in attempts are rate limited to protect accounts (KB-005).
- People can now sign up, log in and log out in the browser; private pages send you to the log-in page and bring you back afterwards, and the password field has a show/hide button (KB-006).
- People can now create workspaces, switch between them, rename them and delete them (with a typed-name confirmation); every workspace has owners, members and viewers, and what each can do is enforced on the server without revealing other people's workspaces (KB-007).
- Workspaces now hold projects: owners and members can create projects (with a short key suggested from the name), rename them and open them; only owners can delete a project, after typing its name to confirm (KB-008).
- Owners can now invite people with a shareable link (as member or viewer, with an expiry date and an optional use limit), see and revoke active links, change people's roles and remove them; anyone can leave a workspace, but the last owner cannot (KB-009).
- Every project now has a board with the columns "To do", "In progress" and "Done"; owners and members can add, rename, reorder (also from the keyboard), delete columns and choose which one counts as "Done", while viewers can only look (KB-011).
- Boards now hold cards: owners and members can add cards at the bottom of a column (several in a row with just the keyboard), open a card at its own link, edit its title and its Markdown description (with a preview) and delete it after confirming; viewers can read cards. Every change to a card is recorded for the history to come (KB-012).
- Cards can now be moved between columns and reordered by dragging with the mouse or entirely from the keyboard (Space to pick up, arrow keys to move, Space to drop, Escape to cancel), with spoken announcements for screen readers; the card dialog also has a "Move to..." option for choosing a column and the top or bottom. Viewers cannot move cards, and a move the server refuses is undone (KB-015).

### Changed

- Deleting a column that still has cards now asks where the cards should go and moves them to the end of that column instead of losing them (KB-012).

### Fixed
