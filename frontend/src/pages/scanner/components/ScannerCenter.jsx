// Contenedor centrado compartido por todas las pantallas del Scanner que
// no son la cámara — mismo espaciado/ancho máximo en todas, para que la
// terminal se sienta consistente entre un estado y otro.
export default function ScannerCenter({ children }) {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 py-16 text-center">
            <div className="flex w-full max-w-sm flex-col items-center gap-5">{children}</div>
        </div>
    );
}
