import { createClient } from '../skills/human-use/scripts/api.mjs';
import { locateProject } from './project.mjs';
import { projectClient } from './service.mjs';

export async function connect({ project = process.env.HUMAN_USE_PROJECT, fallbackProject = process.cwd(), start = false } = {}) {
  if (project) return projectClient(locateProject(project), { start });
  // Explicit v0.2 credentials remain available for the standalone API bridge.
  if (process.env.HUMAN_USE_TOKEN_FILE || process.env.WORKORDER_DATA_DIR) return createClient();
  return projectClient(locateProject(fallbackProject), { start });
}
