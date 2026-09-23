---
description: Runs in a periodic loop to implement all the features related to Facturacion Electronica (SIFEN).
---

Allways work on the worktree attached to the branch feat/integracion-sifen.

Everytime this skill runs, checks what work is in progress in this branch, and resumes from where it left. Fot that, it keeps a memory of the work in progress.

This skill will implement sequentially every user story in /requirements/sifen/Especificacion_SIFEN_Peluqueria.md according to the plan in section 'Plan de implementación por fases'. One user story at a time.

For each feature it will follow all practices defined in the implement-user-story.md skill, except the ones related to branching. ALL SIFEN related changes will be kept in the feat/integracion-sifen branch which has a worktree.

The skill clears its context window before working on any new user story.

A commit and push is done at least at the end of every user story.

Try to gather information from internet as much as possible to unlock yourself, specially regarding the integration with SIFEN. Only ask for user input when there is no other option. You also have access to the technical documentation in '/requirements/sifen/Manual Tecnico V150.pdf'