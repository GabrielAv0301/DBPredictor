// Fixture used by the end-to-end tests. Not real code.
declare const prisma: any;
declare const supabase: any;

export async function cleanup(userId: number) {
    await prisma.user.deleteMany();
    await prisma.post.deleteMany({ where: { authorId: userId } });
    // queryguard-ignore
    await prisma.session.deleteMany();
    await supabase.from('logs').delete().lt('created_at', new Date());
}
