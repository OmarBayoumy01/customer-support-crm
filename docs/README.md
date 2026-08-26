# Documentation

Phase specifications and phase records live here.

| Document                                             | What it is                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`running-the-project.md`](./running-the-project.md) | **Start here to get it running.** Both setups, the development accounts, and the troubleshooting |
| [`phase-01-foundation.md`](./phase-01-foundation.md) | Everything Phase 1 built, decided, and got wrong on the way                                      |

Start with the phase document if you are new. It explains the request lifecycle, the domain
schema, the conventions every later story has to follow, and — usefully — the traps that
cost time the first time round.

## Where the rest of it lives

Documentation for this project is deliberately spread out, each part kept next to the thing
it describes:

| Where                                           | What                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Notion — _User Stories_                         | **The source of truth for story text and acceptance criteria.** Not restated here. |
| `docs/`                                         | Per-phase records: what was built, what was decided, what is still open            |
| `.squad/plans/<feature>/`                       | Per-story plans, decisions, deviations, and what the next story inherits           |
| `.squad/stories/<feature>/`                     | The intake each plan was written from                                              |
| `backend/README.md`, `infrastructure/README.md` | How to work in that part of the repository day to day                              |

A phase document is written when the phase closes. It is a record, not a plan — the plan for
a story lives in `.squad/plans/` while the story is being built.
