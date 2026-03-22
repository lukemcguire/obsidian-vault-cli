export type Component<T = any, U = any> = any;
export function getContext<T>(key: any): T { return undefined as any; }
export function setContext<T>(key: any, value: T): T { return value; }
export function mount(component: any, options: any): any { return {}; }
export function unmount(component: any): void {}
export function tick(): Promise<void> { return Promise.resolve(); }
export function onMount(fn: () => any): void {}
export function onDestroy(fn: () => void): void {}
export function writable<T>(value: T): any { return { subscribe: () => () => {}, set: () => {}, update: () => {} }; }
export function readable<T>(value: T): any { return { subscribe: () => () => {} }; }
export function derived<T>(stores: any, fn: any): any { return readable(undefined); }
