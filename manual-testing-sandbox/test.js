class Calculator {
  constructor() {
    this.result = 0;
  }

  add(number) {
    this.result += number;
    return this;
  }
  sub(number) {
    this.result -= number;
    return this;
  }

  mul(number) {
    this.result *= number;
    return this;
  }

  div(number) {
    if (number === 0) {
      throw new Error("Cannot divide by zero");
    }
    this.result /= number;
    return this;
  }

  get() {
    return this.result;
  }

  clear() {
    this.result = 0;
    return this;
  }
}
