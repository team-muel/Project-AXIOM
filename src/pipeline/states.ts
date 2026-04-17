/** Pipeline states for the AXIOM composition workflow. */
export enum PipelineState {
    IDLE = "IDLE",
    COMPOSE = "COMPOSE",
    CRITIQUE = "CRITIQUE",
    HUMANIZE = "HUMANIZE",
    RENDER = "RENDER",
    RENDER_AUDIO = "RENDER_AUDIO",
    STORE = "STORE",
    DONE = "DONE",
    FAILED = "FAILED",
}

/** Valid state transitions. Key = current state, value = allowed next states. */
const transitions: Record<PipelineState, PipelineState[]> = {
    [PipelineState.IDLE]: [PipelineState.COMPOSE],
    [PipelineState.COMPOSE]: [PipelineState.CRITIQUE, PipelineState.STORE, PipelineState.FAILED],
    [PipelineState.CRITIQUE]: [PipelineState.COMPOSE, PipelineState.HUMANIZE, PipelineState.FAILED],
    [PipelineState.HUMANIZE]: [PipelineState.RENDER, PipelineState.COMPOSE, PipelineState.FAILED],
    [PipelineState.RENDER]: [PipelineState.RENDER_AUDIO, PipelineState.STORE, PipelineState.COMPOSE, PipelineState.FAILED],
    [PipelineState.RENDER_AUDIO]: [PipelineState.STORE, PipelineState.COMPOSE, PipelineState.FAILED],
    [PipelineState.STORE]: [PipelineState.DONE, PipelineState.FAILED],
    [PipelineState.DONE]: [],
    [PipelineState.FAILED]: [],
};

export function canTransition(from: PipelineState, to: PipelineState): boolean {
    return transitions[from].includes(to);
}

export function isTerminal(state: PipelineState): boolean {
    return state === PipelineState.DONE || state === PipelineState.FAILED;
}
