\---

name: superpowers

description: Use disciplined software-engineering workflows for planning, implementation, debugging, testing, code review, and safe changes. Use when a task requires structured investigation, implementation planning, verification, or careful modification of an existing codebase.

\---



\# Superpowers



Use a disciplined engineering workflow instead of immediately changing code.



\## Core Principle



Do not jump directly into implementation.



First understand the task and existing codebase, then plan, implement minimally, and verify.



Prefer evidence over assumptions.



\## Workflow



For substantial development tasks:



1\. Understand the request.

2\. Inspect the existing implementation.

3\. Identify relevant files and dependencies.

4\. Investigate existing patterns.

5\. Create a concise implementation plan.

6\. Review the plan before making large changes.

7\. Implement the smallest safe change.

8\. Run relevant tests and builds.

9\. Review the resulting changes.

10\. Report what was actually verified.



\## Before Coding



Determine:



\- what the user actually wants

\- current behavior

\- expected behavior

\- relevant entry points

\- affected components

\- affected services

\- affected types

\- security implications

\- tests that should be performed



Do not rewrite existing architecture unless necessary.



\## Planning



For non-trivial work, create a plan containing:



1\. Goal

2\. Current implementation

3\. Files affected

4\. Changes required

5\. Dependencies

6\. Security considerations

7\. Testing strategy

8\. Potential risks



Prefer a small number of focused changes over broad refactors.



\## Implementation



While implementing:



\- preserve existing architecture

\- reuse existing services

\- avoid duplicate functionality

\- avoid unnecessary dependencies

\- keep changes focused

\- preserve existing UI unless UI changes are requested

\- preserve security boundaries

\- do not remove working functionality without a reason



\## Debugging



When something fails:



1\. Reproduce the failure.

2\. Capture the exact error.

3\. Identify the failing layer.

4\. Trace the relevant call path.

5\. Find the root cause.

6\. Make the smallest fix.

7\. Reproduce the original failure.

8\. Verify the fix.

9\. Check for regressions.



Do not repeatedly patch symptoms without identifying the underlying cause.



\## Testing



Do not treat a successful build as proof that a feature works.



Distinguish:



```text

SOURCE VERIFIED

BUILD VERIFIED

TEST VERIFIED

RUNTIME VERIFIED

SECURITY VERIFIED

