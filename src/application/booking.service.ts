import { BookingEntity } from '../domain/models';
import { BookingRepository, DistributedLock, EventCache, MessageBus } from '../domain/ports';
import { ConflictError, NotFoundError, isUniqueViolation } from './errors';

export class BookingService {
  constructor(
    private readonly repo: BookingRepository,
    private readonly eventCache: EventCache,
    private readonly lock: DistributedLock,
    private readonly bus: MessageBus,
  ) {}

  async reserveSeat(eventId: number, userId: string): Promise<BookingEntity> {
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw new ConflictError('Invalid eventId');
    }
    if (!userId || typeof userId !== 'string') {
      throw new ConflictError('Invalid userId');
    }

    const lockKey = `lock:event:${eventId}`;
    const acquired = await this.lock.acquire(lockKey, 5_000);
    if (!acquired) {
      // Backpressure: indicate a conflict while another reservation in progress
      throw new ConflictError('Reservation in progress, please retry');
    }
    try {
      // Fetch event via cache first
      let event = await this.eventCache.getEventById(eventId);
      if (!event) {
        event = await this.repo.findEventById(eventId);
        if (!event) {
          throw new NotFoundError('Event not found');
        }
        await this.eventCache.setEvent(event, 60);
      }

      // Run all checks and insert in a SERIALIZABLE tx for safety even with lock
      const booking = await this.repo.withTransaction({ isolationLevel: 'SERIALIZABLE' }, async () => {
        // Check no duplicate
        const existing = await this.repo.findBookingByEventAndUser(eventId, userId);
        if (existing) {
          throw new ConflictError('Booking already exists');
        }

        // Seats availability
        const count = await this.repo.countBookingsByEventId(eventId);
        if (count >= event!.totalSeats) {
          throw new ConflictError('No seats available');
        }

        try {
          const created = await this.repo.createBooking({ eventId, userId });
          return created;
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictError('Booking already exists');
          }
          throw err;
        }
      });

      // Side effects (fire-and-forget ok, but await publish for testability)
      await this.bus.publish('booking.confirmed', {
        event_id: eventId,
        user_id: userId,
        booking_id: booking.id,
      });

      // Invalidate or update cache if needed
      await this.eventCache.invalidateEvent(eventId);

      return booking;
    } finally {
      await acquired.unlock();
    }
  }
}


