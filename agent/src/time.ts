export const nowIso = (): string => new Date().toISOString();
export const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
