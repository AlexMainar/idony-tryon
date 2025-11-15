interface ControlsProps {
    onClose: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    className?: string;
}

export default function Controls({ onClose, onZoomIn, onZoomOut, className }: ControlsProps) {
    return (
        <div className={className}>
            <button
                type="button"
                onClick={onClose}
                className="absolute top-3 right-3 bg-white/70 hover:bg-white text-black text-sm px-3 py-1 rounded-md shadow-md"
            >
                ✖️ Cerrar
            </button>

            <div className="absolute bottom-3 right-3 flex flex-col space-y-2">
                <button
                    type="button"
                    onClick={onZoomIn}
                    className="bg-white/70 hover:bg-white text-black rounded-full w-8 h-8 text-lg shadow"
                    aria-label="Acercar"
                >
                    +
                </button>
                <button
                    type="button"
                    onClick={onZoomOut}
                    className="bg-white/70 hover:bg-white text-black rounded-full w-8 h-8 text-lg shadow"
                    aria-label="Alejar"
                >
                    −
                </button>
            </div>
        </div>
    );
}
