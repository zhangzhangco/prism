import type { SubjectKind } from "@prism/contracts";
import type { AssetsStore } from "./store/assets.js";
import type { SubjectRow } from "./store/subjects.js";

/**
 * What a subject contributes to a run.
 *
 * A subject is a description first and an image second: its name and
 * description become part of the prompt, and its thumbnail — if it has one —
 * becomes a reference image.
 */
export interface SubjectContribution {
  id: string;
  name: string;
  kind: SubjectKind;
  /** The text the subject adds to the prompt. */
  text: string;
  /** The image that stands for the subject, when it has one. */
  thumbnail: { assetId: string; url: string; mime: string } | null;
}

export function subjectText(subject: SubjectRow): string {
  const description = subject.description.trim();
  const data = subject.data as unknown as Record<string, unknown>;

  switch (subject.kind) {
    case "actor": {
      const build = typeof data.build === "string" ? data.build : "regular";
      const height = typeof data.height === "number" ? data.height : 1.75;
      return `${subject.name}${description ? `, ${description}` : ""} (${build} build, ${height}m)`;
    }
    case "scene": {
      const style = typeof data.description === "string" ? data.description : description;
      return `${subject.name}${style ? `, ${style}` : ""}`;
    }
    case "effect": {
      const style = typeof data.style === "string" ? data.style : "";
      return [subject.name, style, description].filter(Boolean).join(", ");
    }
    case "prop":
    default:
      return `${subject.name}${description ? `, ${description}` : ""}`;
  }
}

export function subjectContributions(
  subjectIds: string[],
  subjects: Map<string, SubjectRow>,
  assets: AssetsStore,
  userId: string,
  publicBaseUrl: string,
): SubjectContribution[] {
  const contributions: SubjectContribution[] = [];

  for (const id of subjectIds) {
    const subject = subjects.get(id);
    if (!subject) continue;

    let thumbnail: SubjectContribution["thumbnail"] = null;
    if (subject.thumbnailAssetId) {
      const asset = assets.get(userId, subject.thumbnailAssetId);
      if (asset) {
        thumbnail = {
          assetId: asset.id,
          url: `${publicBaseUrl.replace(/\/$/, "")}/api/assets/${asset.id}`,
          mime: asset.mime,
        };
      }
    }

    contributions.push({
      id: subject.id,
      name: subject.name,
      kind: subject.kind,
      text: subjectText(subject),
      thumbnail,
    });
  }

  return contributions;
}
