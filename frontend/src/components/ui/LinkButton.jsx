import { Link } from "react-router-dom";
import { buttonClassNames } from "./Button.jsx";

// Mismo look que Button pero navega (react-router Link) en vez de ejecutar
// una acción — para CTAs tipo "Administrar evento". Reutiliza el mapeo de
// variant/size de Button.jsx en vez de duplicar las clases.
export default function LinkButton({ to, children, variant = "primary", size = "md", className = "", ...props }) {
  return (
    <Link to={to} className={buttonClassNames({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
