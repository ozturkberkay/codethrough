// The error type the device-flow client throws. In its own file so device_flow.ts
// has just one class.

class DeviceFlowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

export { DeviceFlowError };
