"""UC8176 (IL0398) e-paper controller.

Panels:
- GDEW042M01 (Good Display): 400x300 monochrome
- GDEW042Z15 (Good Display): 400x300 black/white/red (full refresh only)

The mono panel's partial-refresh register LUTs (0x20-0x24) are panel data,
supplied here. UC8176 BUSY is active-LOW; the driver handles that.
"""

import esphome.codegen as cg
from esphome.components.mipi import flatten_sequence
from esphome.core import ID

from ..display import CONF_INIT_SEQUENCE_ID
from . import RequiredPinsModel

# GDEW042M01 partial LUT phase timings (from GxEPD2 GxEPD2_420_M01).
_T1, _T2, _T3, _T4, _T5, _T6 = 20, 20, 40, 40, 3, 3
_LUT_VCOM = [0x00, _T1, _T2, _T3, _T4, 0x01] + [0x00] * 38  # 0x20
_LUT_WW = [0x02, _T1, _T2, _T3, _T5, 0x01] + [0x00] * 36  # 0x21
_LUT_BW = [0x5A, _T1, _T2, _T3, _T4, 0x01] + [0x00] * 36  # 0x22
_LUT_WB = [0x84, _T1, _T2, _T3, _T4, 0x01] + [0x00] * 36  # 0x23
_LUT_BB = [0x01, _T1, _T2, _T3, _T6, 0x01] + [0x00] * 36  # 0x24


class UC8176Mono(RequiredPinsModel):
    def __init__(self, name, **defaults):
        super().__init__(name, "EPaperUC8176", **defaults)

    def get_init_sequence(self, config):
        width, height = self.get_dimensions(config)
        return (
            (0x00, 0x1F, 0x0D),  # panel setting (KW, LUT from OTP)
            (
                0x61,
                (width >> 8) & 0xFF,
                width & 0xFF,
                (height >> 8) & 0xFF,
                height & 0xFF,
            ),  # TRES (resolution)
            (0x50, 0x97),  # VCOM and data interval setting
        )

    def get_constructor_args(self, config) -> tuple:
        width, height = self.get_dimensions(config)
        partial = (
            (0x01, 0x03, 0x00, 0x2B, 0x2B),  # power setting
            (0x06, 0x17, 0x17, 0x17),  # booster soft start
            (0x00, 0x3F),  # panel setting (LUT from register)
            (0x30, 0x3A),  # PLL control
            (
                0x61,
                (width >> 8) & 0xFF,
                width & 0xFF,
                (height >> 8) & 0xFF,
                height & 0xFF,
            ),  # TRES (resolution)
            (0x82, 0x1A),  # VCOM DC setting
            (0x50, 0xD7),  # VCOM/interval, border floating
            (0x20, *_LUT_VCOM),
            (0x21, *_LUT_WW),
            (0x22, *_LUT_BW),
            (0x23, *_LUT_WB),
            (0x24, *_LUT_BB),
        )
        flat = flatten_sequence(partial)
        arr = cg.static_const_array(
            ID(config[CONF_INIT_SEQUENCE_ID].id + "_partial", type=cg.uint8), flat
        )
        return (arr, len(flat))


class UC8176BWR(RequiredPinsModel):
    """3-color, full refresh only (resolution comes from OTP)."""

    def __init__(self, name, **defaults):
        super().__init__(name, "EPaperUC8176BWR", **defaults)

    def get_init_sequence(self, config):
        return (
            (0x06, 0x17, 0x17, 0x17),  # booster soft start
            (0x00, 0x0F, 0x0D),  # panel setting (KWR, LUT from OTP)
        )


UC8176Mono(
    "GDEW042M01", width=400, height=300, data_rate="2MHz", minimum_update_interval="1s"
)
UC8176BWR(
    "GDEW042Z15", width=400, height=300, data_rate="2MHz", minimum_update_interval="30s"
)
