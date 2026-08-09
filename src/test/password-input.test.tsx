import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordInput } from "@/components/ui/password-input";
import { useState } from "react";

function ControlledPassword() {
  const [value, setValue] = useState("segredo123");
  return (
    <div>
      <PasswordInput
        aria-label="Campo senha"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <PasswordInput
        aria-label="Confirmar senha"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <span data-testid="value">{value}</span>
    </div>
  );
}

describe("PasswordInput show/hide", () => {
  it("campo senha inicia oculto", () => {
    render(<PasswordInput aria-label="Senha" defaultValue="abc" />);
    const input = screen.getByLabelText("Senha") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(screen.getByLabelText("Mostrar senha")).toBeTruthy();
  });

  it("clique no olho mostra e segundo clique oculta", () => {
    render(<PasswordInput aria-label="Senha" defaultValue="abc" />);
    const input = screen.getByLabelText("Senha") as HTMLInputElement;
    const toggle = screen.getByLabelText("Mostrar senha");
    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(screen.getByLabelText("Ocultar senha")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Ocultar senha"));
    expect(input.type).toBe("password");
  });

  it("confirmar senha possui toggle próprio e não altera valor", () => {
    render(<ControlledPassword />);
    const toggles = screen.getAllByLabelText("Mostrar senha");
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);
    expect(screen.getByTestId("value").textContent).toBe("segredo123");
  });
});
