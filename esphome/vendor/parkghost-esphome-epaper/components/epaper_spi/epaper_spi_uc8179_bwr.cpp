#include "epaper_spi_uc8179_bwr.h"

#include <algorithm>

#include "epaper_spi_bwr_color.h"

namespace esphome::epaper_spi {

void EPaperUC8179BWR::draw_pixel_at(int x, int y, Color color) {
  if (!this->rotate_coordinates_(x, y))
    return;

  const uint32_t pos = (x / 8) + (y * this->row_width_);
  const uint8_t bit = 0x80 >> (x & 0x07);
  const uint32_t red_offset = this->buffer_length_ / 2u;

  const auto bwr = color_to_bwr(color);

  // Black/White plane: bit 1 = black
  if (bwr == BwrState::BWR_BLACK) {
    this->buffer_[pos] |= bit;
  } else {
    this->buffer_[pos] &= ~bit;
  }

  // Red plane: bit 1 = red
  if (bwr == BwrState::BWR_RED) {
    this->buffer_[red_offset + pos] |= bit;
  } else {
    this->buffer_[red_offset + pos] &= ~bit;
  }
}

void EPaperUC8179BWR::fill(Color color) {
  // Honor active clipping like the base fill(); the base path also sets bounds.
  if (this->get_clipping().is_set()) {
    Display::fill(color);
    return;
  }

  const size_t half_buffer = this->buffer_length_ / 2u;
  const auto bwr = color_to_bwr(color);

  if (bwr == BwrState::BWR_BLACK) {
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[i] = 0xFF;  // black plane on
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[half_buffer + i] = 0x00;  // no red
  } else if (bwr == BwrState::BWR_RED) {
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[i] = 0x00;  // no black
    for (size_t i = 0; i < half_buffer; i++)
      this->buffer_[half_buffer + i] = 0xFF;  // red plane on
  } else {
    this->buffer_.fill(0x00);  // white: no black, no red
  }

  // Mark the whole panel dirty so a fill-only update is not skipped by the FSM.
  this->x_low_ = 0;
  this->y_low_ = 0;
  this->x_high_ = this->width_;
  this->y_high_ = this->height_;
}

bool EPaperUC8179BWR::initialise(bool fast) {
  if (!EPaperBase::initialise(fast)) {  // declarative init
    return false;
  }
  if (fast) {
    // Non-full updates: select the fast whole-screen waveform.
    this->cmd_data(0xE0, {0x02});  // Cascade setting
    this->cmd_data(0xE5, {0x5A});  // Force temperature -> fast waveform
  }
  return true;
}

bool HOT EPaperUC8179BWR::transfer_data() {
  const uint32_t start_time = millis();
  const size_t buffer_length = this->buffer_length_;
  const size_t half_buffer = buffer_length / 2u;

  uint8_t bytes_to_send[MAX_TRANSFER_SIZE];

  // Phase 1: Black/White plane (first half) -> DTM1 (0x10), inverted so 0=black, 1=white
  if (this->current_data_index_ < half_buffer) {
    if (this->current_data_index_ == 0) {
      this->command(0x10);  // DATA START TRANSMISSION 1 (black channel)
    }
    this->start_data_();
    while (this->current_data_index_ < half_buffer) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, half_buffer - this->current_data_index_);
      for (size_t i = 0; i < n; i++) {
        bytes_to_send[i] = ~this->buffer_[this->current_data_index_ + i];
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

  // Phase 2: Red plane (second half) -> DTM2 (0x13), as-is (1=red)
  if (this->current_data_index_ < buffer_length) {
    if (this->current_data_index_ == half_buffer) {
      this->command(0x13);  // DATA START TRANSMISSION 2 (red channel)
    }
    this->start_data_();
    while (this->current_data_index_ < buffer_length) {
      const size_t n = std::min(MAX_TRANSFER_SIZE, buffer_length - this->current_data_index_);
      for (size_t i = 0; i < n; i++) {
        bytes_to_send[i] = this->buffer_[this->current_data_index_ + i];
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

}  // namespace esphome::epaper_spi
