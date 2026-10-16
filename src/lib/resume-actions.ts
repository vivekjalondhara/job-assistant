import { z } from "zod";
import { all, get, now, profile, put, remove, transaction } from "./db";
import { AppError } from "./security";
import type { ResumeFile } from "./files";
import type { Draft, Job } from "./types";
import { deleteObject, resumeKey } from "./storage";
export async function resumeAction(name: string, input: Record<string, unknown>) {
  if (!["resume.default", "resume.delete"].includes(name)) return null;
  const id = z.string().uuid().parse(input.id);
  return transaction(async () => {
    const file = await get<ResumeFile>("file", id);
    if (!file) throw new AppError("Résumé not found.", 404);
    const user = await profile();
    if (name === "resume.default") {
      await put("profile", { ...user, defaultResumeId: id });
      return {
        message: "Default attachment updated. Existing applications keep their selected résumé.",
      };
    }
    const drafts = await all<Draft>("draft");
    if (drafts.some((d) => d.resumeId === id && ["sending", "uncertain"].includes(d.status)))
      throw new AppError(
        "This résumé belongs to an email being sent or awaiting verification. Resolve that send before deleting it.",
        409,
      );
    // Deleting an attachment never edits a message already sent to Gmail.
    await deleteObject(resumeKey(id));
    for (const draft of drafts.filter((d) => d.resumeId === id && d.status !== "sent"))
      await put("draft", {
        ...draft,
        resumeId: "",
        resumeName: "",
        status: "draft",
        version: draft.version + 1,
        approvedHash: null,
        approvedAt: null,
        gmailRawHash: null,
        updatedAt: now(),
      });
    for (const job of await all<Job>("job")) {
      if (job.application?.resumeId === id && job.applicationStatus === "not_submitted")
        await put("job", {
          ...job,
          application: { ...job.application, resumeId: "" },
          match: null,
        });
    }
    await put("profile", {
      ...user,
      defaultResumeId:
        (user.defaultResumeId ?? user.resumeId) === id
          ? ""
          : (user.defaultResumeId ?? user.resumeId),
      ...(user.resumeId === id
        ? { resumeId: "", resumeName: "", resumeText: "", updatedAt: now() }
        : {}),
    });
    await remove("file", id);
    return {
      message: "Résumé deleted. Affected unsent emails need review; sent history is preserved.",
    };
  });
}
