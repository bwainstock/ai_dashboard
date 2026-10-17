#include "epaper_spi_uc8176.h"

#include <algorithm>

#include "esphome/core/helpers.h"
#include "esphome/core/log.h"

namespace esphome::epaper_spi {

void EPaperUC8176::setup() {
  EPaperBase::setup();
  if (this->is_failed())
    return;
  // Only allocate the software previous-frame copy when partial updates are
  // enabled; skipping it saves a full framebuffer of RAM otherwise.
  if (this->is_using_partial_update_()) {
    RAMAllocator<uint8_t> allocator;
    this->old_data_ = allocator.allocate(this->buffer_length_);
    if (this->old_data_ == nullptr) {
      this->mark_failed(LOG_STR("Failed to allocate old data buffer"));
    }
  }
}

bool EPaperUC8176::initialise(bool partial) {
  this->partial_ = partial;
  if (!EPaperBase::initialise(partial)) {  // declarative full init (panel/resolution/VCOM)
    return false;
  }
  if (partial) {
    // Partial init: power/booster/PLL/VCOM-DC + register LUTs (0x20-0x24).
    this->send_init_sequence_(this->partial_sequence_, this->partial_sequence_length_);
  }
  return true;
}

bool HOT EPaperUC8176::transfer_data() {
  const uint32_t start_time = millis();
  const size_t frame = this->buffer_length_;
  uint8_t bytes_to_send[MAX_TRANSFER_SIZE];

  // Partial: enter partial mode with a full-screen window before the data.
  if (this->partial_ && this->current_data_index_ == 0) {
    const uint32_t xe = (this->width_ - 1) | 0x0007;
    const uint16_t ye = this->height_ - 1;
    this->command(0x91);  // PARTIAL IN
    this->cmd_data(0x90, {0x00, 0x00, (uint8_t) (xe / 256), (uint8_t) (xe % 256), 0x00, 0x00, (uint8_t) (ye / 256),
                          (uint8_t) (ye % 256), 0x01});
  }

  // Phase 1: OLD data (0x10). Full -> 0xFF, partial -> previous frame.
  if (this->current_data_index_ < frame) {
    if (this->current_data_index_ == 0) {
      this->command(0x10);
    }
    this->start_data_();
    while (this->current_data_index_ < frame) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, frame - this->current_data_index_);
      if (this->partial_) {
        std::copy_n(&this->old_data_[this->current_data_index_], n, bytes_to_send);
      } else {
        std::fill_n(bytes_to_send, n, (uint8_t) 0xFF);
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

  // Phase 2: NEW data (0x13) = framebuffer (un-inverted). Snapshot into old_data_.
  if (this->current_data_index_ < 2 * frame) {
    if (this->current_data_index_ == frame) {
      this->command(0x13);
    }
    this->start_data_();
    while (this->current_data_index_ < 2 * frame) {
      const size_t off = this->current_data_index_ - frame;
      const size_t n = std::min(MAX_TRANSFER_SIZE, 2 * frame - this->current_data_index_);
      for (size_t i = 0; i < n; i++) {
        const uint8_t b = this->buffer_[off + i];
        bytes_to_send[i] = b;
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

  this->current_data_index_ = 0;
  return true;
}

void EPaperUC8176::power_on() {
  this->command(0x04);  // POWER ON
}

void EPaperUC8176::refresh_screen(bool /*partial*/) {
  this->command(0x12);  // DISPLAY REFRESH
}

void EPaperUC8176::power_off() {
  if (this->partial_) {
    this->command(0x92);  // PARTIAL OUT (after the refresh completed)
  }
  this->command(0x02);  // POWER OFF
}

void EPaperUC8176::deep_sleep() {
  this->cmd_data(0x07, {0xA5});  // DEEP SLEEP with check code
}

}  // namespace esphome::epaper_spi
