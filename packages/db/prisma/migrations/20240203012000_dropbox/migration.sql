-- CreateTable
CREATE TABLE "DropboxUser" (
    "id" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "DropboxUser_pkey" PRIMARY KEY ("id")
);
