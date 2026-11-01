import type { DrizzleTable } from './drizzleSchema';
import { prismaAccessorName, type PrismaModel } from './prismaSchema';

/**
 * In-memory knowledge about the user's ORM definitions, keyed by source file
 * so that a single file can be re-indexed when it changes.
 */
export class ProjectModel {
    private readonly prismaByFile = new Map<string, PrismaModel[]>();
    private readonly drizzleByFile = new Map<string, DrizzleTable[]>();
    private prismaIndex = new Map<string, PrismaModel>();
    private drizzleIndex = new Map<string, DrizzleTable>();

    public setPrismaFile(file: string, models: PrismaModel[]): void {
        if (models.length === 0) this.prismaByFile.delete(file);
        else this.prismaByFile.set(file, models);
        this.rebuildPrisma();
    }

    public setDrizzleFile(file: string, tables: DrizzleTable[]): void {
        if (tables.length === 0) this.drizzleByFile.delete(file);
        else this.drizzleByFile.set(file, tables);
        this.rebuildDrizzle();
    }

    public hasFile(file: string): boolean {
        return this.prismaByFile.has(file) || this.drizzleByFile.has(file);
    }

    public removeFile(file: string): void {
        const hadPrisma = this.prismaByFile.delete(file);
        const hadDrizzle = this.drizzleByFile.delete(file);
        if (hadPrisma) this.rebuildPrisma();
        if (hadDrizzle) this.rebuildDrizzle();
    }

    /** `prisma.userProfile` → model `UserProfile`. */
    public prismaModel(accessor: string): PrismaModel | undefined {
        return this.prismaIndex.get(accessor);
    }

    public drizzleTable(variable: string): DrizzleTable | undefined {
        return this.drizzleIndex.get(variable);
    }

    public hasDrizzleTable(variable: string): boolean {
        return this.drizzleIndex.has(variable);
    }

    public get stats(): { prismaModels: number; drizzleTables: number } {
        return { prismaModels: this.prismaIndex.size, drizzleTables: this.drizzleIndex.size };
    }

    private rebuildPrisma(): void {
        const index = new Map<string, PrismaModel>();
        for (const models of this.prismaByFile.values()) {
            for (const model of models) {
                const accessor = prismaAccessorName(model.name);
                if (!index.has(accessor)) index.set(accessor, model);
            }
        }
        this.prismaIndex = index;
    }

    private rebuildDrizzle(): void {
        const index = new Map<string, DrizzleTable>();
        for (const tables of this.drizzleByFile.values()) {
            for (const table of tables) {
                if (!index.has(table.variable)) index.set(table.variable, table);
            }
        }
        this.drizzleIndex = index;
    }
}
