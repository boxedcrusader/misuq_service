// Ordered account-deletion helper (README §7: "clear retention/deletion
// policy for cancelled accounts").
//
// prisma.user.delete() alone throws P2003 on Send_audienceId_fkey (and
// would throw the same way on SignalRecord_feedbackReportId_fkey for a
// solo FeedbackReport delete): those two relations are intentionally
// onDelete: Restrict (schema.prisma), and Postgres checks a non-deferrable
// Restrict/NoAction constraint immediately, before the rest of the
// User-delete cascade (Story -> ContentPiece -> Send -> FeedbackReport)
// finishes in the same statement. Confirmed via
// prisma/scripts/test-user-delete-cascade.js (fails identically with
// Restrict and with NoAction, and with a raw SQL DELETE, so it's Postgres
// FK semantics, not a Prisma engine artifact -- non-deferrable NO ACTION
// checks immediately, same as Restrict).
//
// Fix: delete the two classes of row that trip Restrict *before* the
// User-delete cascade ever reaches them, in one transaction:
//   1. SignalRecord rows for this user -- unblocks FeedbackReport's
//      cascade-delete off Send.
//   2. Send rows for this user's content pieces or audiences -- unblocks
//      Audience's cascade-delete off User.
// Then prisma.user.delete() cascades the rest (Story, ContentPiece,
// Audience, VoiceProfile, and any remaining SignalRecord) without hitting
// a Restrict constraint.
//
// The eventual NestJS service layer (not built yet -- see project status)
// must call this instead of prisma.user.delete() directly.

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} userId
 */
async function deleteUserCascade(prisma, userId) {
  await prisma.$transaction([
    prisma.signalRecord.deleteMany({ where: { userId } }),
    prisma.send.deleteMany({
      where: {
        OR: [{ contentPiece: { story: { userId } } }, { audience: { userId } }],
      },
    }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}

module.exports = { deleteUserCascade };
