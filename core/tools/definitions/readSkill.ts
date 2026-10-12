import { GetTool, Tool } from "../..";
import { loadMarkdownSkills } from "../../config/markdown/loadMarkdownSkills";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export interface SkillSummary {
  name: string;
  description: string;
}

export function buildReadSkillTool(skills: SkillSummary[]): Tool {
  return {
    type: "function",
    displayTitle: "Read Skill",
    wouldLikeTo: "read skill {{{ skillName }}}",
    isCurrently: "reading skill {{{ skillName }}}",
    hasAlready: "read skill {{{ skillName }}}",
    readonly: true,
    isInstant: true,
    group: BUILT_IN_GROUP_NAME,
    defaultToolPolicy: "allowedWithoutPermission",
    function: {
      name: BuiltInToolNames.ReadSkill,
      description: `
Use this tool to read the content of a skill by its name. Skills contain detailed instructions for specific tasks. The skill name should match one of the available skills listed below: 
${skills.map((skill) => `\nname: ${skill.name}\ndescription: ${skill.description}\n`)}`,
      parameters: {
        type: "object",
        required: ["skillName"],
        properties: {
          skillName: {
            type: "string",
            description:
              "The name of the skill to read. This should match the name from the available skills.",
          },
        },
      },
    },
  };
}

export async function loadSkillSummaries(
  ide: Parameters<typeof loadMarkdownSkills>[0],
): Promise<SkillSummary[]> {
  try {
    const { skills } = await loadMarkdownSkills(ide);
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
  } catch {
    return [];
  }
}

export const readSkillTool: GetTool = async (params) =>
  buildReadSkillTool(await loadSkillSummaries(params.ide));
