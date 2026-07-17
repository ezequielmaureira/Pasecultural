import cloudinary from "../config/cloudinary.js";

export const uploadImageService = (fileBuffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: "image",
                folder: "pasecultural",
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );

        stream.end(fileBuffer);
    });
};

export const deleteImageService = (publicId) => {
    return cloudinary.uploader.destroy(publicId, { resource_type: "image" });
};
