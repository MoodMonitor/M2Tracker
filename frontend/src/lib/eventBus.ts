/**
 * Simple typed event bus for cross-component communication.
 * Decouples logic — e.g. notifying the whole app about session expiry.
 */

type EventMap = {
  'session:expired': undefined;
  'api:error': { status: number; message: string };
};

type EventKey = keyof EventMap;

type EventCallback<T extends EventKey> = (data: EventMap[T]) => void;

class EventBus {
  private listeners: { [K in EventKey]?: Array<EventCallback<K>> } = {};

  /** Subscribes to an event. Returns an unsubscribe function. */
  on<K extends EventKey>(key: K, callback: EventCallback<K>): () => void {
    if (!this.listeners[key]) {
      this.listeners[key] = [];
    }
    this.listeners[key]!.push(callback);

    return () => {
      this.listeners[key] = this.listeners[key]?.filter(cb => cb !== callback);
    };
  }

  /** Emits an event, calling all registered listeners. */
  emit<K extends EventKey>(key: K, data: EventMap[K]) {
    this.listeners[key]?.forEach(callback => callback(data));
  }
}

export const eventBus = new EventBus();