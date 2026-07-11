
## Prompt Versioning
Prompts live in `prompts/<agent>/<version>.md` with YAML frontmatter metadata containing version, agent name, model, and description. The planner currently uses `v1`. Versioning allows tracking prompt changes over time and eventually A/B testing or rollback. Note honestly that only 2 of the agents (planner, gst_agent) have been externalized in this way due to time constraints — the other 3 workers (doc_agent, pan_agent, bank_agent) still have their logic inline and would follow the same pattern if extended.
