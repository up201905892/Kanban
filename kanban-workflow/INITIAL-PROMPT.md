# Initial prompt — Kanban

Paste the text below into Claude Code in the first session, with the repository folder open and this kit already copied to the repository root.

---

```
Let's start the Kanban project. First read CLAUDE.md and the files in docs/workflow/ — they describe the four-phase workflow (Planning → Development → Testing → Done), the transition rules you must always follow, and the language rule (everything in the repository in English; talk to me in European Portuguese).

Context:
- I'm a university student and this is the second project in my portfolio to get hired as a software engineer (front end) and, later, to become a project manager. The first one is the Design System (@up201905892/ui), which this project will use once it is published.
- The goal is an agile project management tool: kanban board, sprints, burndown and real-time collaborative editing (Yjs), with authentication, roles and server-side authorization.
- I'll use it for real to manage my own projects and university group work, so it must be reliable, not just a demo.
- Target duration: 7–8 weeks part-time.
- The process matters as much as the code: the history in docs/workflow/ will be shown in interviews, especially for the PM side.

What I need now (planning only, no code):
1. Use the planner agent to create the full MVP backlog in docs/workflow/01-planning.md, following the phases defined in the agent.
2. First define a "Common criteria" section (general, API, UI, real time) and cite it in tasks instead of repeating it.
3. Prefer vertical slices (schema + API + UI + tests) for features; meaningful priorities (High only for what blocks).
4. Every task starts as Proposed. Show me the index table and a summary per phase so I can approve or ask for changes.
5. Ask me the technical decisions that need my choice, each with your recommendation. At least:
   - self-hosted Yjs or Liveblocks;
   - Fastify or NestJS;
   - own authentication (cookie session) or a service (Auth.js, Lucia, Supabase Auth);
   - where to deploy (only to prepare the task; I connect the deploy myself).

Once I approve, commit the plan. From then on the daily cycle runs on its own in GitHub Actions; I approve the next tasks in docs/workflow/approvals.md.
```
