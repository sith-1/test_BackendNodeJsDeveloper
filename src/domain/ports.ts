import { BookingEntity, CreateBookingInput, EventEntity } from './models';

export interface EventCache {
  getEventById(eventId: number): Promise<EventEntity | null>;
  setEvent(event: EventEntity, ttlSeconds?: number): Promise<void>;
  invalidateEvent(eventId: number): Promise<void>;
}

export interface BookingRepository {
  findEventById(eventId: number): Promise<EventEntity | null>;
  countBookingsByEventId(eventId: number): Promise<number>;
  findBookingByEventAndUser(eventId: number, userId: string): Promise<BookingEntity | null>;
  createBooking(input: CreateBookingInput): Promise<BookingEntity>; // must be atomic inside provided transaction
  withTransaction<T>(options: { isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' }, fn: () => Promise<T>): Promise<T>;
}

export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<{ unlock: () => Promise<void> } | null>;
}

export interface MessageBus {
  publish(queue: string, message: unknown): Promise<void>;
}

