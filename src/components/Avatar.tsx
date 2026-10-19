export default function Avatar({ color, size = 38 }: { color: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ '--agent-color': color, width: size, height: size } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="avatar-body">
        <i />
        <i />
      </span>
    </span>
  );
}
