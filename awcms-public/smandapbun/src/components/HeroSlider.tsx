import React from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, EffectFade } from "swiper/modules";

import "swiper/css";
import "swiper/css/effect-fade";

interface HeroSliderProps {
    images: ImageMetadata[];
    interval?: number;
}

export const HeroSlider: React.FC<HeroSliderProps> = ({
    images,
    interval = 5000,
}) => {
    if (images.length === 0) return null;

    return (
        <div className="absolute inset-0 z-0">
            <Swiper
                modules={[Autoplay, EffectFade]}
                effect="fade"
                autoplay={{
                    delay: interval,
                    disableOnInteraction: false,
                }}
                loop={true}
                className="h-full w-full"
            >
                {images.map((image) => (
                    <SwiperSlide key={image.src}>
                        <div
                            className="absolute inset-0 bg-cover bg-bottom"
                            style={{ backgroundImage: `url('${image.src}')` }}
                        />
                    </SwiperSlide>
                ))}
            </Swiper>

            {/* Scrim gradient overlay - Darker for better contrast */}
            <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                    background: `linear-gradient(
                        to right,
                        rgba(0, 0, 0, 0.9) 0%,
                        rgba(0, 0, 0, 0.6) 50%,
                        transparent 100%
                    )`,
                }}
            />
            <div
                className="absolute inset-0 z-10 pointer-events-none"
                style={{
                    background: `linear-gradient(
                        to top,
                        rgba(0, 0, 0, 0.8) 0%,
                        transparent 50%
                    )`,
                }}
            />
        </div>
    );
};
