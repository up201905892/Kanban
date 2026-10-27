# Changelog

All notable changes to this project are recorded here, in the format of [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added

- The app now has a starting point: a web page and a server with a health check that reports when the service is running (KB-001).
- The server now connects to a database and has a readiness check that tells whether the database is reachable (KB-002).
- Errors from the server now follow one consistent format and carry a request id, which makes problems easier to trace and report (KB-003).

### Changed

### Fixed
