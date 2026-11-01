import * as vscode from 'vscode';
import type { LiteralValue } from '../core/detectors/types';
import { describeFilter } from '../core/impact/describe';
import type { ImpactAnalysis } from '../core/impact/ImpactEngine';
import { resolveTable } from '../core/schema/resolver';
import { buildReport } from '../core/simulation/report';
import { planSimulation, type SimulationPlan } from '../core/simulation/SimulationPlanner';
import type { ConnectionManager } from '../db/ConnectionManager';
import type { SimulationReport } from '../shared/types';
import { Logger } from '../utils/logger';
import type { ProjectIndexService } from './ProjectIndexService';
import type { SchemaService } from './SchemaService';
import { Settings } from './settings';

export interface PreparedSimulation {
    kind: 'prepared';
    plan: SimulationPlan;
    table: string;
    truncateWithoutCascade: boolean;
}

export function isPrepared(
    value: PreparedSimulation | SimulationReport
): value is PreparedSimulation {
    return (value as PreparedSimulation).kind === 'prepared';
}

export function failure(message: string): SimulationReport {
    return {
        ok: false,
        error: message,
        baseRows: 0,
        exact: false,
        counts: [],
        cascadeDeletedRows: 0,
        nullifiedRows: 0,
        blockedBy: [],
        warnings: [],
        durationMs: 0,
        finishedAt: Date.now(),
    };
}

function parseInput(text: string, list: boolean): LiteralValue | LiteralValue[] {
    const one = (raw: string): LiteralValue => {
        const v = raw.trim();
        return /^null$/i.test(v) ? null : v;
    };
    return list ? text.split(',').map(one) : one(text);
}

/**
 * Exact, read-only row counting ("simulation"). Nothing is executed except
 * SELECT count(*) queries inside a READ ONLY transaction.
 */
export class SimulationService {
    constructor(
        private readonly connection: ConnectionManager,
        private readonly schema: SchemaService,
        private readonly project: ProjectIndexService
    ) {}

    /**
     * Step 1 — validates and asks the user for runtime values. Returns a plan,
     * a failure report, or undefined when the user cancelled. Runs before any
     * progress UI so prompts are never shown under a spinner.
     */
    public async prepare(
        analysis: ImpactAnalysis
    ): Promise<PreparedSimulation | SimulationReport | undefined> {
        if (!this.connection.isConnected) return failure('Not connected to a database.');
        const index = this.schema.index ?? (await this.schema.refresh().catch(() => null));
        if (!index) return failure('The database schema is not loaded yet. Try again in a moment.');

        const { mutation } = analysis;
        const table =
            analysis.table ??
            (mutation.table.kind !== 'unknown'
                ? resolveTable(mutation.table, index, this.project.model).table
                : undefined);
        if (!table) {
            return failure(
                mutation.table.kind === 'unknown'
                    ? 'The table name is built at runtime; it cannot be simulated.'
                    : `Table "${mutation.table.name}" was not found in the connected database.`
            );
        }

        const supplied = await this.askForValues(analysis);
        if (supplied === undefined) return undefined;

        let plan: SimulationPlan;
        try {
            plan = planSimulation(mutation, table, index, this.project.model, supplied);
        } catch (error) {
            return failure(error instanceof Error ? error.message : String(error));
        }

        return {
            kind: 'prepared',
            plan,
            table: `${table.schema}.${table.name}`,
            truncateWithoutCascade: mutation.operation === 'truncate' && !mutation.truncateCascade,
        };
    }

    /** Step 2 — runs the read-only count queries. Never throws. */
    public async execute(prepared: PreparedSimulation): Promise<SimulationReport> {
        const { plan } = prepared;
        Logger.info(
            `Simulation: ${plan.queries.length} read-only count queries on ${prepared.table}`
        );
        Logger.debug(
            'Simulation SQL',
            plan.queries.map((q) => q.sql)
        );
        try {
            const result = await this.connection.count({
                queries: plan.queries.map((q) => q.sql),
                params: plan.params,
                statementTimeoutMs: Settings.simulationTimeoutMs,
            });
            return buildReport(
                plan,
                result.counts,
                result.durationMs,
                prepared.truncateWithoutCascade
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error('Simulation failed', error);
            return failure(message);
        }
    }

    /**
     * Filters whose value is only known at runtime (`where: { id: userId }`):
     * ask the user for values, or count without them (upper bound).
     */
    private async askForValues(
        analysis: ImpactAnalysis
    ): Promise<Map<number, LiteralValue | LiteralValue[]> | undefined> {
        const values = new Map<number, LiteralValue | LiteralValue[]>();
        const dynamic = analysis.mutation.filters
            .map((filter, index) => ({ filter, index }))
            .filter(({ filter }) => filter.value?.kind === 'expression');
        if (dynamic.length === 0) return values;

        const enter = 'Enter values';
        const skip = 'Ignore those conditions';
        const choice = await vscode.window.showQuickPick(
            [
                {
                    label: `$(edit) ${enter}`,
                    id: enter,
                    detail: `Provide test values for: ${dynamic.map((d) => describeFilter(d.filter)).join(', ')}`,
                },
                {
                    label: `$(filter) ${skip}`,
                    id: skip,
                    detail: 'Count without them. The result is an upper bound.',
                },
            ],
            {
                title: 'QueryGuard: some filter values are only known at runtime',
                placeHolder: 'How should the simulation handle them?',
                ignoreFocusOut: true,
            }
        );
        if (!choice) return undefined;
        if (choice.id === skip) return values;

        for (const { filter, index } of dynamic) {
            const list = filter.operator === 'in';
            const input = await vscode.window.showInputBox({
                title: `QueryGuard: value for ${describeFilter(filter)}`,
                prompt: list
                    ? 'Comma-separated values. Use NULL for null.'
                    : 'Value to compare with. Use NULL for null. Leave empty to cancel.',
                ignoreFocusOut: true,
                validateInput: (v) =>
                    v.trim() === '' ? 'Enter a value (or press Escape to cancel).' : undefined,
            });
            if (input === undefined) return undefined;
            values.set(index, parseInput(input, list));
        }
        return values;
    }
}
