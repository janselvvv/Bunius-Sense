import logoImage from "../assets/fermalogo.png";

type LogoProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

export default function Logo({ size = "md", className = "" }: LogoProps) {
  const px = size === "sm" ? 32 : size === "lg" ? 56 : 44;

  return (
    <img
      src={logoImage}
      alt="FERMA Logo"
      width={px}
      height={px}
      className={`object-contain ${className}`}
      loading="lazy"
    />
  );
}
