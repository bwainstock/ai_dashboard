"""UC8151D monochrome e-paper controller.

Panels:
- GDEW029T5D (Good Display): 128x296 monochrome

Full refresh uses the OTP waveform. Partial refresh runs a panel-specific
"partial init" sequence (power / booster / PLL / VCOM-DC and the register LUTs
0x20-0x24) supplied here as panel data. UC8151 BUSY is active-LOW; the driver
handles that, so no `inverted:` is needed on the busy pin.
"""

import esphome.codegen as cg
from esphome.components.mipi import flatten_sequence
from esphome.core import ID

from ..display import CONF_INIT_SEQUENCE_ID
from . import RequiredPinsModel

# GDEW029T5D partial-refresh register LUTs (Good Display "2in9d" reference).
#
# Single-phase differential waveform: only changed pixels (BW/WB) are driven,
# once, for _PHASE frames toward the target colour; unchanged pixels (WW/BB)
# get no drive. On WFT0290CZ10 (LP) lots the GxEPD2 T5D tuning (short phase
# 0x19, VCOM-DC 0x08) made ghosting WORSE — 25 frames doesn't switch the
# particles fully — so we keep the GD structure and LENGTHEN the phase to push
# changed particles harder. NOTE: single-phase can reduce but not truly clear
# ghosting; only a two-phase "clear-then-set" LUT eliminates it (at the cost of
# a brief flash on changed pixels). GD reference default was 0x30 (48 frames).
_PHASE = 0x60  # single-phase frame count (96); try 0x48/0x50/0x58 per lot
_LUT_VCOM = [0x02, _PHASE, 0x00, 0x00, 0x00, 0x01] + [0x00] * 38  # 0x20
_LUT_WW = [0x00] * 42  # 0x21
_LUT_BW = [0x80, _PHASE, 0x00, 0x00, 0x00, 0x01] + [0x00] * 36  # 0x22
_LUT_WB = [0x40, _PHASE, 0x00, 0x00, 0x00, 0x01] + [0x00] * 36  # 0x23
_LUT_BB = [0x00] * 42  # 0x24


class UC8151(RequiredPinsModel):
    def __init__(self, name, **defaults):
        super().__init__(name, "EPaperUC8151", **defaults)

    def _resolution(self, config) -> tuple:
        width, height = self.get_dimensions(config)
        return (0x61, width & 0xFF, (height >> 8) & 0xFF, height & 0xFF)

    def get_init_sequence(self, config):
        return (
            (0x00, 0x1F, 0x0D),  # panel setting (KW, LUT from OTP)
            self._resolution(config),
            (0x50, 0x97),  # VCOM and data interval setting
        )

    def get_constructor_args(self, config) -> tuple:
        partial = (
            (0x01, 0x03, 0x00, 0x2B, 0x2B, 0x03),  # power setting
            (0x06, 0x17, 0x17, 0x17),  # booster soft start
            (0x00, 0xBF, 0x0D),  # panel setting (LUT from register)
            (0x30, 0x3C),  # PLL control
            self._resolution(config),
            (0x82, 0x12),  # VCOM DC setting
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


UC8151(
    "GDEW029T5D", width=128, height=296, data_rate="2MHz", minimum_update_interval="1s"
)
