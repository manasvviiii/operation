import { describe, it, expect } from 'vitest';
import { loadPrompt } from './planner';

describe('Planner Prompts', () => {
  it('loads prompt text and strips YAML frontmatter successfully', () => {
    const promptText = loadPrompt('planner', 'v1');
    expect(promptText).toBeDefined();
    expect(promptText.length).toBeGreaterThan(0);
    // Should not contain the frontmatter delimiters
    expect(promptText).not.toContain('---');
    // Should contain known prompt content
    expect(promptText).toContain('You are a workflow planner');
  });

  it('throws a clear error for a nonexistent agent/version combination', () => {
    expect(() => {
      loadPrompt('nonexistent_agent', 'v999');
    }).toThrow('Prompt file not found for agent nonexistent_agent, version v999');
  });
});
