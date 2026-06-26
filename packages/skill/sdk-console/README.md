# @cube-ai/skill-sdk-console

Skill management console SDK for AI skill center.

## Overview

This SDK provides a client for managing AI skills in the skill center, including:

- Browsing skill library
- Managing my skills (shelf)
- Creating, updating, and deleting skills
- Publishing skills to the library
- AI-assisted skill creation with SSE streaming

## Installation

```bash
bun add @cube-ai/skill-sdk-console
```

## Usage

```typescript
import { createSkillConsoleClient, SkillConsoleClient, SKILL_CATEGORY_MAP } from '@cube-ai/skill-sdk-console';

// Create client
const client = createSkillConsoleClient({
  baseUrl: 'http://localhost:3000',
  headers: { 'Authorization': 'Bearer token' }
});

// Browse skill library
const skills = await client.browseLibrarySkills({ q: 'data', category: 'DATA_QUERY' });

// Create a new skill
const newSkill = await client.createSkill({
  name: 'Emergency Plan Generator',
  description: 'Generate emergency plans based on event type',
  category: 'WORK_EXECUTION',
  usageExample: 'User: "Fire in building A" -> AI: Generate evacuation plan',
  outputSpec: 'Markdown with 6 sections',
  inputReq: 'Required: event type, location',
  pitfallGuide: 'Don\'t forget to check resource availability',
  checklist: 'Check all emergency exits',
});

// Add to my skills
await client.addToMySkills({ ref: newSkill.id });

// AI-assisted skill creation with streaming
const proposed = await client.proposeSkill(
  { name: 'Incident Report', description: 'Generate incident reports', category: 'ANALYSIS_REPORT' },
  {
    onDelta: (delta) => console.log('AI is generating:', delta),
  }
);
```

## API Reference

### Skill Library

- `browseLibrarySkills(opts?)` - Browse published skills
- `getLibrarySkill(ref)` - Get skill details from library

### Skill Management

- `listSkills()` - List all tenant skills
- `getSkill(id)` - Get skill details
- `createSkill(body)` - Create new skill
- `updateSkill(id, body)` - Update existing skill
- `deleteSkill(id)` - Delete skill
- `publishSkill(id)` - Publish to library
- `unpublishSkill(id)` - Unpublish from library

### My Skills (Shelf)

- `listMySkills()` - List my skills
- `addToMySkills(req)` - Add skill to shelf
- `removeFromMySkills(shelfId)` - Remove from shelf
- `toggleSkillEnabled(shelfId, enabled)` - Enable/disable skill
- `syncSkillVersion(shelfId, versionNo?)` - Sync to latest version
- `checkSkillUpdate(shelfId)` - Check for updates

### AI-Assisted Creation

- `proposeSkill(req, opts?)` - AI generates six configurations via SSE streaming
