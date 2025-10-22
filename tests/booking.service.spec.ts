import { BookingService } from '../src/application/booking.service';
import { ConflictError, NotFoundError } from '../src/application/errors';
import { BookingEntity, EventEntity } from '../src/domain/models';
import { BookingRepository, DistributedLock, EventCache, MessageBus } from '../src/domain/ports';

function createFakes() {
  const events = new Map<number, EventEntity>();
  const bookings: BookingEntity[] = [];
  const cache = new Map<number, EventEntity>();

  const eventCache: EventCache = {
    async getEventById(eventId) { return cache.get(eventId) ?? null; },
    async setEvent(event) { cache.set(event.id, event); },
    async invalidateEvent(eventId) { cache.delete(eventId); },
  };

  const repo: BookingRepository = {
    async findEventById(eventId) { return events.get(eventId) ?? null; },
    async countBookingsByEventId(eventId) { return bookings.filter(b => b.eventId === eventId).length; },
    async findBookingByEventAndUser(eventId, userId) { return bookings.find(b => b.eventId === eventId && b.userId === userId) ?? null; },
    async createBooking(input) {
      if (bookings.some(b => b.eventId === input.eventId && b.userId === input.userId)) {
        const err: any = new Error('duplicate');
        err.code = '23505';
        throw err;
      }
      const created: BookingEntity = { id: bookings.length + 1, eventId: input.eventId, userId: input.userId, createdAt: new Date() };
      bookings.push(created);
      return created;
    },
    async withTransaction(_opts, fn) { return await fn(); },
  };

  // Simple in-memory mutex keyed by string
  const held = new Set<string>();
  const lock: DistributedLock = {
    async acquire(key) {
      if (held.has(key)) return null;
      held.add(key);
      return { unlock: async () => { held.delete(key); } };
    },
  };

  const published: any[] = [];
  const bus: MessageBus = {
    async publish(queue, message) { published.push({ queue, message }); },
  };

  return { events, bookings, eventCache, repo, lock, bus, published };
}

describe('BookingService.reserveSeat', () => {
  test('успешное бронирование', async () => {
    const { events, eventCache, repo, lock, bus } = createFakes();
    events.set(1, { id: 1, name: 'E1', totalSeats: 2 });
    const service = new BookingService(repo, eventCache, lock, bus);
    const booking = await service.reserveSeat(1, 'u1');
    expect(booking).toMatchObject({ eventId: 1, userId: 'u1' });
  });

  test('мероприятие не найдено', async () => {
    const { eventCache, repo, lock, bus } = createFakes();
    const service = new BookingService(repo, eventCache, lock, bus);
    await expect(service.reserveSeat(999, 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });

  test('нет мест', async () => {
    const { events, eventCache, repo, lock, bus } = createFakes();
    events.set(1, { id: 1, name: 'E1', totalSeats: 1 });
    const service = new BookingService(repo, eventCache, lock, bus);
    await service.reserveSeat(1, 'u1');
    await expect(service.reserveSeat(1, 'u2')).rejects.toBeInstanceOf(ConflictError);
  });

  test('дубликат брони', async () => {
    const { events, eventCache, repo, lock, bus } = createFakes();
    events.set(1, { id: 1, name: 'E1', totalSeats: 2 });
    const service = new BookingService(repo, eventCache, lock, bus);
    await service.reserveSeat(1, 'u1');
    await expect(service.reserveSeat(1, 'u1')).rejects.toBeInstanceOf(ConflictError);
  });

  test('гонка: параллельные запросы на один и тот же event', async () => {
    const { events, eventCache, repo, lock, bus } = createFakes();
    events.set(1, { id: 1, name: 'E1', totalSeats: 1 });
    const service = new BookingService(repo, eventCache, lock, bus);

    const p1 = service.reserveSeat(1, 'u1');
    const p2 = service.reserveSeat(1, 'u2');
    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});


