interface ControlsProps {
  onClose: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  className?: string;
}

export default function Controls({
  onClose,
  onZoomIn,
  onZoomOut,
  className,
}: ControlsProps) {
  return (
    <div
      className={`controls flex items-center gap-3 ${className ?? ""}`}
      style={{ top: "1rem", right: "1rem", left: "auto" }}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="
          w-12 h-12 
          rounded-full 
          bg-white/90 
          shadow-lg 
          backdrop-blur 
          flex items-center justify-center 
          hover:bg-white 
          transition
        "
        aria-label="Cerrar"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="black"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Zoom controls – horizontal stack */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onZoomIn}
          className="
            w-12 h-12 
            rounded-full 
            bg-white/90 
            shadow-lg 
            backdrop-blur 
            flex items-center justify-center 
            hover:bg-white 
            transition
          "
          aria-label="Acercar"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="black"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onZoomOut}
          className="
            w-12 h-12 
            rounded-full 
            bg-white/90 
            shadow-lg 
            backdrop-blur 
            flex items-center justify-center 
            hover:bg-white 
            transition
          "
          aria-label="Alejar"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="black"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>
    </div>
  );
}
