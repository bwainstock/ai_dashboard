#include "epaper_spi_uc8179.h"

#include <algorithm>

#include "esphome/core/helpers.h"
#include "esphome/core/log.h"

namespace esphome::epaper_spi {

void EPaperUC8179::setup() {
  EPaperBase::setup();
  if (this->is_failed())
    return;
  // Software copy of the previously displayed frame, the differential base for
  // partial updates (the panel is deep-slept between updates, so its RAM is not
  // retained). Only needed when partial updates are enabled; skipping it saves a
  // full framebuffer of RAM otherwise. PSRAM-capable via RAMAllocator.
  if (this->is_using_partial_update_()) {
    RAMAllocator<uint8_t> allocator;
    this->old_data_ = allocator.allocate(this->buffer_length_);
    if (this->old_data_ == nullptr) {
      this->mark_failed(LOG_STR("Failed to allocate old data buffer"));
    }
  }
}

bool EPaperUC8179::initialise(bool partial) {
  this->partial_ = partial;
  if (!EPaperBase::initialise(partial)) {  // sends the declarative full init
    return false;
  }
  if (partial) {
    // Switch from the full-refresh waveform (0x50 = 0x10) to the flicker-free
    // differential partial waveform.
    this->cmd_data(0x50, {0xA9, 0x07});  // VCOM/interval: DDX[0]=1 inverts data polarity
    this->cmd_data(0xE0, {0x02});        // Cascade setting
    this->cmd_data(0xE5, {0x6E});        // Force temperature -> fast partial LUT
  }
  return true;
}

bool HOT EPaperUC8179::transfer_data() {
  const uint32_t start_time = millis();
  const size_t frame = this->buffer_length_;  // single plane
  uint8_t bytes_to_send[MAX_TRANSFER_SIZE];

  // Partial: enter partial mode and set the (full-screen) window before data.
  if (this->partial_ && this->current_data_index_ == 0) {
    const uint16_t xe = this->width_ - 1;
    const uint16_t ye = this->height_ - 1;
    this->command(0x91);  // PARTIAL IN
    this->cmd_data(0x90, {0x00, 0x00, (uint8_t) (xe >> 8), (uint8_t) (xe & 0xFF), 0x00, 0x00, (uint8_t) (ye >> 8),
                          (uint8_t) (ye & 0xFF), 0x01});
  }

  // Phase 1: OLD data (0x10). Full -> 0x00, partial -> previous frame.
  if (this->current_data_index_ < frame) {
    if (this->current_data_index_ == 0) {
      this->command(0x10);  // DATA START TRANSMISSION 1 (old data)
    }
    this->start_data_();
    while (this->current_data_index_ < frame) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, frame - this->current_data_index_);
      if (this->partial_) {
        std::copy_n(&this->old_data_[this->current_data_index_], n, bytes_to_send);
      } else {
        std::fill_n(bytes_to_send, n, (uint8_t) 0x00);
      }
      this->write_array(bytes_to_send, n);
      this->current_data_index_ += n;
      if (millis() - start_time > MAX_TRANSFER_TIME) {
        this->disable();
        return false;
      }
    }
    this->disable();
  }

  // Phase 2: NEW data (0x13). Full -> ~framebuffer, partial -> framebuffer as-is
  // (0x50=0xA9 already inverts the polarity). Snapshot the frame into old_data_
  // for the next partial update.
  if (this->current_data_index_ < 2 * frame) {
    if (this->current_data_index_ == frame) {
      this->command(0x13);  // DATA START TRANSMISSION 2 (new data)
    }
    this->start_data_();
    while (this->current_data_index_ < 2 * frame) {
      const size_t off = this->current_data_index_ - frame;
      const size_t n = std::min(MAX_TRANSFER_SIZE, 2 * frame - this->current_data_index_);
      for (size_t i = 0; i < n; i++) {
        const uint8_t b = this->buffer_[off + i];
        bytes_to_send[i] = this->partial_ ? b : (uint8_t) ~b;
        if (this->old_data_ != nullptr)
          this->old_data_[off + i] = b;
      }
      this->write_array(bytes_to_send, n);
      this->current_data_index_ += n;
      if (millis() - start_time > MAX_TRANSFER_TIME) {
        this->disable();
        return false;
      }
    }
    this->disable();
  }

  // Leave partial mode once the data is written, so the refresh (0x12) runs
  // outside the 0x91/0x92 window -- GxEPD2 defaults to this on this panel
  // ("usePartialUpdateWindow = false; // set false for better image").
  if (this->partial_) {
    this->command(0x92);  // PARTIAL OUT
  }

  this->current_data_index_ = 0;
  return true;
}

}  // namespace esphome::epaper_spi
