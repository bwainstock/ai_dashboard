"""SSD1683 e-paper controller.

Panels:
- DEPG0420 (DKE): 400x300 black/white/red

SSD1683 uses its built-in OTP waveform LUT (loaded automatically at refresh), so
no LUT is supplied by the model. BUSY is active-HIGH (the component default).
"""

from . import RequiredPinsModel


class SSD1683BWR(RequiredPinsModel):
    def __init__(self, name, **defaults):
        super().__init__(name, "EPaperSSD1683", **defaults)

    def get_init_sequence(self, config):
        _, height = self.get_dimensions(config)
        # SWRESET (0x12) is issued in reset(); the FSM waits for idle before this
        # sequence runs. The RAM window is set by the driver (set_ram_area_).
        return (
            (
                0x01,
                (height - 1) & 0xFF,
                (height - 1) >> 8,
                0x00,
            ),  # driver output control
            (0x3C, 0x05),  # border waveform
            (0x18, 0x80),  # built-in temperature sensor
        )


SSD1683BWR(
    "DEPG0420", width=400, height=300, data_rate="4MHz", minimum_update_interval="20s"
)
