import EventCard from "./EventCard.jsx";
import HorizontalScroller from "./HorizontalScroller.jsx";

// Shelf horizontal de EventCard (mismo componente que usa la grilla de
// "Todos los eventos" y /eventos): sólo cambia el contenedor, no la tarjeta.
export default function EventsCarousel({ events }) {
  if (events.length === 0) return null;

  return (
    <HorizontalScroller>
      {events.map((event) => (
        <div key={event.id} className="w-40 shrink-0 snap-start sm:w-48 lg:w-56">
          <EventCard event={event} />
        </div>
      ))}
    </HorizontalScroller>
  );
}
