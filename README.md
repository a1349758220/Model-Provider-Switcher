# Model Provider Switcher

## Status

This project is unfinished.

Only Windows is supported.

This is a small browser-server tool for updating:

- Codex Desktop user data / config directory, detected at startup
- database file: `state_5.sqlite`
- table: `threads`
- column: `model_provider`
- rollout JSONL file from column: `rollout_path`
- JSON path in rollout lines: `payload.model_provider`

## Run

```powershell
cd C:\Users\Administrator\Documents\Codex\model-provider-switcher
python app.py
```

Open:

```text
http://127.0.0.1:8765
```

## Backup

Every update creates backups under:

```text
C:\Users\Administrator\.codex\backups\model-provider-switcher
```

The database is backed up with SQLite's backup API. Every touched rollout file is copied before it is rewritten.
