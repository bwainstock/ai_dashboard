#pragma once

#include "epaper_spi_uc8179_base.h"

namespace esphome::epaper_spi {

/**
 * UC8179 monochrome e-paper displays (e.g. Good Display GDEY075T7, 800x480).
 *
 * Buffer layout: 1 bit per pixel, single plane, bit 1 = white / bit 0 = black
 * (inherited from EPaperBase::draw_pixel_at / fill).
 *
 * Refresh strategy (controlled by `full_update_every`):
 * - Full refresh (every Nth update): flashing full-refresh waveform for best
 *   de-ghosting. OLD (0x10) = 0x00, NEW (0x13) = ~framebuffer, VCOM 0x50 = 0x10.
 * - Partial refresh (the other updates): flicker-free differential waveform.
 *   OLD (0x10) = previous frame, NEW (0x13) = framebuffer, VCOM 0x50 = 0xA9
 *   (inverts data polarity) with the fast LUT selected via 0xE5 = 0x6E.
 *
 * The previous frame is tracked in software (old_data_) so the panel can be
 * deep-slept between every update without losing the differential reference.
 */
class EPaperUC8179 : public EPaperUC8179Base {
 public:
  EPaperUC8179(const char *name, uint16_t width, uint16_t height, const uint8_t *init_sequence,
               size_t init_sequence_length)
      : EPaperUC8179Base(name, width, height, init_sequence, init_sequence_length) {
    this->buffer_length_ = this->row_width_ * height;  // single 1-bpp plane
  }

 protected:
  void setup() override;
  bool initialise(bool partial) override;
  bool transfer_data() override;

  // Previous frame, used as the differential base for partial updates.
  uint8_t *old_data_{nullptr};
  // Whether the update in progress is a partial (differential) refresh.
  bool partial_{false};
};

}  // namespace esphome::epaper_spi
