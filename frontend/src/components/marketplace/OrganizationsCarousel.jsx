import OrganizationCard from "./OrganizationCard.jsx";
import HorizontalScroller from "./HorizontalScroller.jsx";

// Shelf horizontal de OrganizationCard — mismo patrón exacto que
// EventsCarousel.jsx: sólo cambia la tarjeta, el contenedor (scroll nativo
// con snap, funciona con touch) es el mismo componente reutilizado.
export default function OrganizationsCarousel({ organizations }) {
  if (organizations.length === 0) return null;

  return (
    <HorizontalScroller>
      {organizations.map((organization) => (
        <div
          key={organization.id}
          className="w-[calc((100vw-3rem)/3)] shrink-0 snap-start sm:w-40 lg:w-44"
        >
          <OrganizationCard organization={organization} />
        </div>
      ))}
    </HorizontalScroller>
  );
}
