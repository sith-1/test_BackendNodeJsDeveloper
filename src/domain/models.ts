export interface EventEntity {
  id: number;
  name: string;
  totalSeats: number;
}

export interface BookingEntity {
  id: number;
  eventId: number;
  userId: string;
  createdAt: Date;
}

export interface CreateBookingInput {
  eventId: number;
  userId: string;
}

